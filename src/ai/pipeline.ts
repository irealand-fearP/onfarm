import type { Db } from '../db/index.js';
import type { Farm, Product } from '../domain/types.js';
import { todayKst } from '../lib/datetime.js';
import { recognizeProduct } from './product-recognition.js';
import type { ProviderSelection } from './providers/index.js';
import { writeProduct } from './product-writer.js';
import { analyzeQuality } from './quality-analysis.js';
import { decideFlow } from './rule-engine.js';
import type { FlowDecision } from './rule-engine.js';
import { catalog, findProductByCode, matchSkus } from './sku-matcher.js';
import type { SkuCandidate } from './sku-matcher.js';
import type { ImageFeatures, RecognitionResult } from './types.js';

export interface PipelineRequest {
  imageBase64?: string;
  mimeType?: string;
  features?: ImageFeatures;
  /** 사용자가 폴백 화면에서 직접 고른 품목. 있으면 인식 단계를 건너뛴다. */
  forcedProductCode?: string;
  farm: Farm;
  farmerName: string;
}

export interface PipelineResult {
  recognition: RecognitionResult;
  decision: FlowDecision;
  product: Product | null;
  skus: SkuCandidate[];
  selectedSku: SkuCandidate | null;
  draft: { title: string; description: string } | null;
  ai: {
    source: string;
    offline: boolean;
    degraded: string | null;
    demoMode: boolean;
    label: string;
  };
  /** manual 모드에서 큰 버튼으로 보여줄 전체 품목 */
  catalog: Array<Pick<Product, 'code' | 'name_ko' | 'emoji'>>;
}

function sourceLabel(source: string, offline: boolean): string {
  switch (source) {
    case 'heuristic':
      return '로컬 색·질감 규칙 판정';
    case 'openai':
      return 'OpenAI 이미지 인식';
    case 'anthropic':
      return 'Claude 이미지 인식';
    case 'mock':
      return '데모 고정 응답';
    default:
      return offline ? '로컬 판정' : '외부 인식';
  }
}

/**
 * IMAGE → 품목인식 → 품질 참고신호 → SKU 매칭 → 룰엔진 → 상품문안
 * 각 단계는 별도 모듈이며, 여기서는 순서와 병합만 담당한다.
 */
export async function runPipeline(
  db: Db,
  req: PipelineRequest,
  selection?: ProviderSelection,
): Promise<PipelineResult> {
  const items = catalog(db);
  const catalogInput = items.map((p) => ({
    code: p.code,
    name_ko: p.name_ko,
    category: p.category,
    variety: p.variety,
  }));

  // STEP 1 — 품목 인식 (또는 사용자가 직접 고른 품목)
  let recognition: RecognitionResult;
  let source: string;
  let offline: boolean;
  let degraded: string | null;
  let demoMode: boolean;

  const localQuality = analyzeQuality(req.features);

  if (req.forcedProductCode) {
    const picked = items.find((p) => p.code === req.forcedProductCode);
    recognition = {
      category: picked?.category ?? 'unknown',
      product: picked?.code ?? '',
      product_ko: picked?.name_ko ?? '',
      variety_guess: picked?.variety ?? null,
      quality_hint: localQuality.hint,
      confidence: 1,
      detected_issues: localQuality.issues,
      description_basis: localQuality.basis,
      alternatives: [],
    };
    source = 'manual';
    offline = true;
    degraded = null;
    demoMode = false;
  } else {
    const outcome = await recognizeProduct(
      {
        ...(req.imageBase64 ? { imageBase64: req.imageBase64 } : {}),
        ...(req.mimeType ? { mimeType: req.mimeType } : {}),
        ...(req.features ? { features: req.features } : {}),
        catalog: catalogInput,
      },
      selection,
    );
    recognition = outcome.recognition;
    source = outcome.source;
    offline = outcome.offline;
    degraded = outcome.degraded;
    demoMode = outcome.demoMode;

    // STEP 2 — 로컬 품질 신호 병합. 사진 자체에 문제가 있으면 그쪽을 우선한다.
    if (req.features) {
      const mergedIssues = Array.from(
        new Set([...localQuality.issues, ...recognition.detected_issues]),
      );
      recognition = {
        ...recognition,
        detected_issues: mergedIssues,
        description_basis: Array.from(
          new Set([...recognition.description_basis, ...localQuality.basis]),
        ),
        quality_hint: localQuality.issues.length > 0 ? '확인필요' : recognition.quality_hint,
      };
    }
  }

  // STEP 3 — SKU 매칭 (가격의 유일한 출처)
  const skus = recognition.product ? matchSkus(db, recognition.product) : [];
  const selectedSku = skus[0] ?? null;
  const product = recognition.product ? findProductByCode(db, recognition.product) : null;

  // STEP 4 — 룰 엔진
  const decision = decideFlow(recognition, skus.length > 0);

  // STEP 5 — 상품 문안 자동 생성
  const today = todayKst();
  const draft =
    product && selectedSku
      ? writeProduct({
          product,
          sku: selectedSku,
          farm: req.farm,
          farmerName: req.farmerName,
          recognition,
          harvestedOn: today,
          today,
          aiSourceLabel: sourceLabel(source, offline),
        })
      : null;

  return {
    recognition,
    decision,
    product,
    skus,
    selectedSku,
    draft,
    ai: {
      source,
      offline,
      degraded,
      demoMode,
      label: sourceLabel(source, offline),
    },
    catalog: items.map((p) => ({ code: p.code, name_ko: p.name_ko, emoji: p.emoji })),
  };
}
