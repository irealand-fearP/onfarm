import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeQuality } from '../quality-analysis.js';
import { VisionProviderError } from '../types.js';
import type { RecognitionResult, VisionInput, VisionProvider } from '../types.js';

/**
 * AI 허브 농산물 품질(QC) 이미지로 학습한 CNN provider.
 *
 * 서버는 런타임 의존성 0 이 원칙이라 `onnxruntime-node` 를 **선택적 의존성**으로 둔다.
 * 설치돼 있으면 이 provider 가 뜨고, 없으면 생성 단계에서 거부돼 기존 로컬 판정으로 폴백한다.
 * (설치: npm i -O onnxruntime-node)
 *
 * 이미지 디코딩도 하지 않는다. JPEG 디코더를 서버에 들이면 의존성이 늘기 때문에,
 * 이미 캔버스로 사진을 다루고 있는 브라우저가 224×224 RGB 픽셀을 함께 보낸다.
 * 따라서 features 와 동일한 신뢰 경계에 있다 — DEVELOPMENT_STATUS.md 에 명시.
 */

/** 품목 하나에 대한 등급 근거. 전체 평균은 품목별 편차를 가린다(양파 0.388 vs 배 1.0). */
export interface ItemEvidence {
  grade_object_acc?: number;
  weight_only_baseline?: number;
  item_object_acc?: number;
  n_objects?: number;
  grade_usable?: boolean;
}

export interface CnnMetadata {
  items: string[];
  grades: string[];
  img_size: number;
  normalize: { mean: number[]; std: number[] };
  val_object_level?: { item?: number; grade?: number; n_objects?: number };
  /**
   * 실전 신뢰도 상한. val_object_level 은 검증셋 '측정 기록' 이라 손대지 않고,
   * 실제 촬영 조건에서 관측된 상한을 여기 따로 적는다(capConfidence 가 둘 중 작은 값을 쓴다).
   */
  field_ceiling?: number;
  weight_only_grade_baseline?: number;
  mean_confidence_when_wrong?: number | null;
  per_item?: Record<string, ItemEvidence>;
}

export function loadMetadata(dir: string): CnnMetadata {
  const path = join(dir, 'metadata.json');
  if (!existsSync(path)) throw new VisionProviderError(`metadata.json 없음: ${dir}`, 'cnn');
  const meta = JSON.parse(readFileSync(path, 'utf8')) as CnnMetadata;
  if (!Array.isArray(meta.items) || meta.items.length === 0) {
    throw new VisionProviderError('metadata.items 가 비어 있습니다.', 'cnn');
  }
  if (!meta.normalize?.mean || !meta.normalize?.std) {
    throw new VisionProviderError('metadata.normalize 누락', 'cnn');
  }
  return meta;
}

/**
 * 모델이 낸 확률을 그대로 쓰지 않는다.
 *
 * 학습 데이터는 스튜디오 촬영이고 독립 표본은 개체 수(1,258개)뿐이라, 실제 폰 사진에서의
 * 정확도는 검증셋 수치보다 낮을 수밖에 없다. 그래서 **개체 단위 검증 정확도**를 상한으로 잡는다.
 * (한바구니에서 provider 확률을 재검증 없이 믿었다가 안전장치가 통째로 우회된 전례가 있다)
 *
 * 그런데 val_object_level.item = 1.0 이라 Math.min(raw, 1.0) 은 아무것도 자르지 않았다
 * (실측 관측 최댓값 0.962 — outputs/confidence_calibration.txt).
 * 이 1.0 은 '검증셋에서 실제로 측정된 값' 이므로 임의로 낮춰 적으면 측정 기록이 훼손된다.
 * 그래서 metadata 의 측정치는 그대로 두고, **실전 상한(field_ceiling)** 을 별도 필드로 두어
 * 둘 중 작은 값을 쓴다. 기본값 0.74 는 우리 조건 시험에서 학습 5품목 CNN(TTA켬)이 보인
 * top-1 적중률(0.74~0.95) 중 보수적인 쪽이다.
 */
const DEFAULT_FIELD_CEILING = 0.74;

export function capConfidence(raw: number, meta: CnnMetadata): number {
  const validationCeiling = meta.val_object_level?.item ?? 0.8;
  const fieldCeiling = meta.field_ceiling ?? DEFAULT_FIELD_CEILING;
  return Math.max(0, Math.min(raw, validationCeiling, fieldCeiling));
}

/**
 * 등급 출력을 화면에 쓸 수 있는가 — 중량만 보는 기준선을 못 넘으면 쓰지 않는다.
 *
 * 품목명을 주면 그 품목의 근거(per_item)를 먼저 본다. 전체 평균(0.705 > 0.58)은 통과하지만
 * 양파는 개체 등급 정확도 0.388 로 중량 기준선 0.738 에 못 미친다 — 평균이 이 사실을 가린다.
 * per_item 이 없는 품목은 지금까지처럼 전체 평균으로 판단한다.
 */
export function gradeIsUsable(meta: CnnMetadata, itemNameKo?: string): boolean {
  const item = itemNameKo ? meta.per_item?.[itemNameKo] : undefined;
  if (item) {
    if (item.grade_usable !== undefined) return item.grade_usable;
    const acc = item.grade_object_acc;
    const base = item.weight_only_baseline;
    if (acc !== undefined && base !== undefined) return acc > base;
  }
  const model = meta.val_object_level?.grade;
  const baseline = meta.weight_only_grade_baseline;
  if (model === undefined || baseline === undefined) return false;
  return model > baseline;
}

function softmax(logits: Float32Array | number[]): number[] {
  const arr = Array.from(logits);
  const max = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/**
 * 한 장을 중앙에서 여러 배율로 잘라 함께 판정한다.
 *
 * 학습 사진은 농산물이 화면을 꽉 채운 스튜디오 촬영이다(선형 차지비율 중앙값 98%).
 * 사람이 폰으로 찍으면 피사체가 화면의 절반도 안 되기 쉽고, 그 구간은 모델이 학습에서
 * 한 번도 본 적 없는 입력이라 정확도가 무너진다. 중앙을 잘라 확대하면 입력이 학습 분포
 * 안으로 돌아온다.
 *
 * 배율을 여러 개 쓰는 이유는 피사체가 얼마나 큰지 미리 알 수 없어서이고,
 * 1.0 을 항상 포함하는 이유는 피사체가 가장자리에 치우쳤을 때 크롭이 오히려 잘라내기 때문이다.
 */
export const TTA_SCALES = [1, 0.7, 0.5, 0.35, 0.25] as const;

/**
 * 실제로 쓸 배율. 기본은 다중 배율이고, `ONFARM_CNN_TTA=off` 면 원본 한 장만 쓴다.
 *
 * 측정용 스위치다. 켜고/끈 상태를 **같은 서버 코드**로 재야 비교가 성립하고,
 * 운영에서 TTA 가 문제를 일으키면 코드 변경 없이 되돌릴 수 있다.
 */
export function activeScales(env: NodeJS.ProcessEnv = process.env): readonly number[] {
  return env.ONFARM_CNN_TTA === 'off' ? [1] : TTA_SCALES;
}

/**
 * 배율별 확률을 최댓값으로 합친 뒤 합이 1이 되게 되돌린다.
 *
 * 되돌리지 않으면 화면에 보이는 신뢰도가 부풀려진다 — '틀렸는데 자신 있는' 판정이 늘어난다.
 * (신뢰도 상한 capConfidence 는 이 값 위에 그대로 걸린다)
 */
export function fuseItemProbs(perScale: number[][]): number[] {
  const first = perScale[0];
  if (!first) return [];
  const fused = first.map((_, k) => Math.max(...perScale.map((row) => row[k] ?? 0)));
  const total = fused.reduce((a, b) => a + b, 0) || 1;
  return fused.map((p) => p / total);
}

export class CnnVisionProvider implements VisionProvider {
  readonly name = 'cnn';
  readonly offline = true;

  private session: unknown = null;

  private constructor(
    private readonly meta: CnnMetadata,
    private readonly modelPath: string,
    private readonly ort: any,
  ) {}

  /** onnxruntime-node 가 없으면 여기서 실패한다 → 팩토리가 heuristic 으로 폴백한다. */
  static async create(dir: string): Promise<CnnVisionProvider> {
    const meta = loadMetadata(dir);
    const modelPath = join(dir, 'onfarm_qc.onnx');
    if (!existsSync(modelPath)) {
      throw new VisionProviderError(`모델 파일 없음: ${modelPath}`, 'cnn');
    }
    let ort: any;
    try {
      const moduleName = 'onnxruntime-node';
      ort = await import(moduleName);
    } catch {
      throw new VisionProviderError(
        'onnxruntime-node 가 설치돼 있지 않습니다. `npm i -O onnxruntime-node` 후 다시 시작하세요.',
        'cnn',
      );
    }
    return new CnnVisionProvider(meta, modelPath, ort);
  }

  /** 브라우저가 보낸 224×224 RGB(0~255) 를 정규화된 NCHW 텐서로 바꾼다. */
  toTensor(rgb: Uint8Array): Float32Array {
    const size = this.meta.img_size;
    const expected = size * size * 3;
    if (rgb.length !== expected) {
      throw new VisionProviderError(
        `픽셀 길이가 다릅니다. 기대 ${expected}, 실제 ${rgb.length}`,
        'cnn',
      );
    }
    const { mean, std } = this.meta.normalize;
    const out = new Float32Array(expected);
    const plane = size * size;
    for (let i = 0; i < plane; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = (rgb[i * 3 + c] ?? 0) / 255;
        out[c * plane + i] = (v - (mean[c] ?? 0)) / (std[c] ?? 1);
      }
    }
    return out;
  }

  /**
   * 224 원본에서 중앙 정사각(비율 scale)을 잘라 다시 224 로 확대한다(이중선형).
   *
   * 서버는 브라우저가 보낸 224×224 만 받는다. 원본 해상도가 오지 않으므로 화소를 되살릴 수는
   * 없지만, 잃어버린 것은 화소가 아니라 '피사체가 프레임을 채우는 정도'다.
   */
  cropCenter(rgb: Uint8Array, scale: number): Uint8Array {
    const size = this.meta.img_size;
    if (scale >= 1) return rgb;
    const crop = Math.max(8, Math.round(size * scale));
    const off = Math.floor((size - crop) / 2);
    const out = new Uint8Array(size * size * 3);
    const ratio = size > 1 ? (crop - 1) / (size - 1) : 0;
    for (let y = 0; y < size; y += 1) {
      const sy = y * ratio;
      const y0 = Math.floor(sy);
      const y1 = Math.min(y0 + 1, crop - 1);
      const wy = sy - y0;
      for (let x = 0; x < size; x += 1) {
        const sx = x * ratio;
        const x0 = Math.floor(sx);
        const x1 = Math.min(x0 + 1, crop - 1);
        const wx = sx - x0;
        const i00 = ((off + y0) * size + off + x0) * 3;
        const i01 = ((off + y0) * size + off + x1) * 3;
        const i10 = ((off + y1) * size + off + x0) * 3;
        const i11 = ((off + y1) * size + off + x1) * 3;
        const o = (y * size + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          const a = (rgb[i00 + c] ?? 0) * (1 - wx) + (rgb[i01 + c] ?? 0) * wx;
          const b = (rgb[i10 + c] ?? 0) * (1 - wx) + (rgb[i11 + c] ?? 0) * wx;
          out[o + c] = Math.round(a * (1 - wy) + b * wy);
        }
      }
    }
    return out;
  }

  async analyzeProduct(input: VisionInput): Promise<RecognitionResult> {
    if (!input.pixels) {
      throw new VisionProviderError('224×224 픽셀이 없습니다.', 'cnn');
    }
    const quality = analyzeQuality(input.features);

    if (!this.session) {
      this.session = await this.ort.InferenceSession.create(this.modelPath);
    }
    const size = this.meta.img_size;
    const plane = size * size * 3;

    // 배율별 텐서를 한 배치로 묶어 한 번에 돌린다(전방 통과 5회, run 호출 1회).
    const pixels = input.pixels;
    const scales = activeScales();
    const batch = new Float32Array(scales.length * plane);
    scales.forEach((scale, i) => {
      batch.set(this.toTensor(this.cropCenter(pixels, scale)), i * plane);
    });
    const feeds = {
      image: new this.ort.Tensor('float32', batch, [scales.length, 3, size, size]),
    };
    const out = await (this.session as any).run(feeds);

    const nItems = this.meta.items.length;
    const itemLogits = out['item_logits'].data as Float32Array;
    const perScale = scales.map((_, i) =>
      softmax(itemLogits.subarray(i * nItems, (i + 1) * nItems)),
    );
    const itemProbs = fuseItemProbs(perScale);

    // 등급은 원본 배율(첫 줄)만 쓴다. 잘라 확대한 그림에서 등급이 어떻게 되는지는 재본 적이 없다.
    const nGrades = this.meta.grades.length;
    const gradeProbs = softmax((out['grade_logits'].data as Float32Array).subarray(0, nGrades));

    /*
      팀원 저장소는 '배율마다 1순위가 갈리면' 근거 문구에 촬영 안내를 덧붙였다. 우리는 넣지 않는다.
      description_basis 가 product-writer 를 거쳐 **소비자에게 보이는 매물 설명**에 그대로 실리기
      때문이다(실측: 매물 설명에 "가까이서 한 번 더 찍으면 더 정확합니다." 가 그대로 찍혔다).
      촬영 안내는 판매자 화면(web/seller/sell.html)의 안내 문구가 맡는다.
    */

    const ranked = itemProbs
      .map((p, i) => ({ name: this.meta.items[i] ?? '', p }))
      .sort((a, b) => b.p - a.p);
    const top = ranked[0];
    if (!top) throw new VisionProviderError('출력이 비어 있습니다.', 'cnn');

    // 학습 라벨은 한국어 품목명이므로 카탈로그의 code 로 되돌린다.
    const match = input.catalog.find((c) => c.name_ko === top.name);
    if (!match) {
      // 카탈로그에 없는 품목이면 판정하지 않는다(가격/SKU 가 없다).
      return {
        category: 'unknown',
        product: '',
        product_ko: '',
        variety_guess: null,
        quality_hint: quality.hint,
        confidence: 0,
        detected_issues: [...quality.issues, `학습 품목(${top.name})이 판매 카탈로그에 없습니다.`],
        description_basis: quality.basis,
        alternatives: [],
      };
    }

    const gradeIdx = gradeProbs.indexOf(Math.max(...gradeProbs));
    const modelGrade = this.meta.grades[gradeIdx];
    // 등급은 기준선을 넘고 사진 자체에 문제가 없을 때만 쓴다.
    const hint =
      gradeIsUsable(this.meta, top.name) && quality.issues.length === 0 && modelGrade
        ? (modelGrade as RecognitionResult['quality_hint'])
        : quality.hint;

    return {
      category: match.category,
      product: match.code,
      product_ko: match.name_ko,
      variety_guess: match.variety,
      quality_hint: hint,
      confidence: Number(capConfidence(top.p * (0.6 + 0.4 * quality.signalQuality), this.meta).toFixed(3)),
      detected_issues: quality.issues,
      description_basis: quality.basis,
      alternatives: ranked.slice(1, 3).flatMap((r) => {
        const alt = input.catalog.find((c) => c.name_ko === r.name);
        return alt
          ? [{ product: alt.code, product_ko: alt.name_ko, confidence: Number(capConfidence(r.p, this.meta).toFixed(3)) }]
          : [];
      }),
    };
  }
}
