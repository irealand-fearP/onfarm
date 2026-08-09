import { analyzeQuality } from '../quality-analysis.js';
import type { ImageFeatures, RecognitionResult, VisionInput, VisionProvider } from '../types.js';

/**
 * 외부 API 없이 동작하는 규칙 기반 품목 후보 산출기.
 *
 * 색상(H) · 채도(S) · 명도(V) · 에지밀도의 프로토타입 거리로 점수를 매기고
 * softmax 로 후보 확률을 만든다. 딥러닝 모델이 아니며, 신뢰도 상한을 0.86 으로 잠가
 * '확신하는 판정'처럼 보이지 않게 한다. 향후 CV 모델로 교체되는 자리다.
 */
interface Prototype {
  code: string;
  hue: number; // 0..360
  sat: number; // 0..1
  val: number; // 0..1
  edge: number; // 0..1
}

/*
  프로토타입 값은 각 품목의 대표 표피색을 HSV 로 옮긴 것이다.
  (예: 신고배 #C7BA7B → H50 S0.38 V0.78 / 양파 표피는 더 진한 황갈색)
  실제 촬영 데이터가 쌓이면 이 표는 학습된 모델로 대체되는 자리다.
*/
export const PROTOTYPES: Prototype[] = [
  { code: 'pear', hue: 50, sat: 0.38, val: 0.78, edge: 0.3 },
  { code: 'apple', hue: 5, sat: 0.72, val: 0.55, edge: 0.28 },
  { code: 'mandarin', hue: 28, sat: 0.9, val: 0.8, edge: 0.3 },
  { code: 'peach', hue: 18, sat: 0.52, val: 0.78, edge: 0.28 },
  { code: 'sweet_potato', hue: 352, sat: 0.48, val: 0.45, edge: 0.45 },
  { code: 'potato', hue: 34, sat: 0.3, val: 0.6, edge: 0.45 },
  { code: 'onion', hue: 38, sat: 0.62, val: 0.68, edge: 0.3 },
  { code: 'red_pepper', hue: 2, sat: 0.8, val: 0.4, edge: 0.72 },
];

const W = { hue: 0.55, sat: 0.2, val: 0.15, edge: 0.1 };
const MAX_CONFIDENCE = 0.86;

function circularDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

function gaussian(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/** 12칸 히스토그램에서 최빈 구간 주변을 가중평균해 대표 색상각을 구한다. */
export function dominantHue(histogram: number[]): number {
  const bins = histogram.length;
  if (bins === 0) return 0;
  let peak = 0;
  for (let i = 1; i < bins; i += 1) {
    if ((histogram[i] ?? 0) > (histogram[peak] ?? 0)) peak = i;
  }
  const step = 360 / bins;
  let x = 0;
  let y = 0;
  for (let offset = -1; offset <= 1; offset += 1) {
    const idx = (peak + offset + bins) % bins;
    const weight = histogram[idx] ?? 0;
    const angle = ((idx + 0.5) * step * Math.PI) / 180;
    x += weight * Math.cos(angle);
    y += weight * Math.sin(angle);
  }
  if (x === 0 && y === 0) return (peak + 0.5) * step;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface ScoredCandidate {
  code: string;
  score: number;
  probability: number;
}

export function scoreCandidates(features: ImageFeatures, allowed?: string[]): ScoredCandidate[] {
  const hue = dominantHue(features.hueHistogram);
  const pool = allowed ? PROTOTYPES.filter((p) => allowed.includes(p.code)) : PROTOTYPES;
  const scored = pool.map((p) => {
    const s =
      W.hue * gaussian(circularDistance(hue, p.hue), 22) +
      W.sat * gaussian(Math.abs(features.meanSaturation - p.sat), 0.28) +
      W.val * gaussian(Math.abs(features.meanValue - p.val), 0.3) +
      W.edge * gaussian(Math.abs(features.edgeDensity - p.edge), 0.35);
    return { code: p.code, score: s, probability: 0 };
  });

  // softmax (temperature 는 후보 간 차이를 과장하지 않도록 크게 잡는다)
  const T = 0.12;
  const exps = scored.map((c) => Math.exp(c.score / T));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  scored.forEach((c, i) => {
    c.probability = (exps[i] ?? 0) / sum;
  });
  return scored.sort((a, b) => b.probability - a.probability);
}

export class HeuristicVisionProvider implements VisionProvider {
  readonly name = 'heuristic';
  readonly offline = true;

  async analyzeProduct(input: VisionInput): Promise<RecognitionResult> {
    const features = input.features;
    const quality = analyzeQuality(features);

    if (!features) {
      return {
        category: 'unknown',
        product: '',
        product_ko: '',
        variety_guess: null,
        quality_hint: '확인필요',
        confidence: 0,
        detected_issues: quality.issues,
        description_basis: [],
        alternatives: [],
      };
    }

    const allowed = input.catalog.map((c) => c.code);
    const ranked = scoreCandidates(features, allowed);
    const top = ranked[0];
    if (!top) {
      return {
        category: 'unknown',
        product: '',
        product_ko: '',
        variety_guess: null,
        quality_hint: quality.hint,
        confidence: 0,
        detected_issues: quality.issues,
        description_basis: quality.basis,
        alternatives: [],
      };
    }

    const item = input.catalog.find((c) => c.code === top.code);
    // 이미지 신호가 나쁘면 확률을 그대로 신뢰도로 쓰지 않는다.
    const confidence = Math.min(MAX_CONFIDENCE, top.probability * (0.55 + 0.45 * quality.signalQuality));

    return {
      category: item?.category ?? 'unknown',
      product: top.code,
      product_ko: item?.name_ko ?? top.code,
      variety_guess: item?.variety ?? null,
      quality_hint: quality.hint,
      confidence: Number(confidence.toFixed(3)),
      detected_issues: quality.issues,
      description_basis: quality.basis,
      alternatives: ranked.slice(1, 3).map((c) => {
        const alt = input.catalog.find((x) => x.code === c.code);
        return {
          product: c.code,
          product_ko: alt?.name_ko ?? c.code,
          confidence: Number(Math.min(MAX_CONFIDENCE, c.probability).toFixed(3)),
        };
      }),
    };
  }
}
