/*
  신뢰 단계(A/B/C) 판정 — 화면이 "지금 이 품목을 얼마나 맞혀 봤는지"만 근거로 말하게 한다.

  왜 사진별 confidence 숫자를 쓰지 않는가:
  outputs/confidence_calibration.txt 실측에서 heuristic 신뢰도는 상위 50% 구간 적중 43.9%,
  하위 50% 구간 45.3% 로 오히려 역전됐다(차이 -1.4p). 순서에 정보가 없는 값은 어떤 보정으로도
  살릴 수 없다. 그래서 단계는 **품목별 실측치**로만 정하고, 사진별 숫자는 화면에서 없앤다.

  왜 재현율이 아니라 정밀도인가:
  화면이 하는 말은 "감자 같아요" 다. 이 문장이 맞을 확률은 '진짜 감자를 감자로 맞힌 비율'
  (재현율 100%)이 아니라 '감자라고 말했을 때 실제 감자였던 비율'(정밀도 18%)이다.
  두 값이 82p 나 벌어지는 이유는, 색표에 없는 8품목(쌀·마늘·포도·감·고등어·새우·오징어·전복)
  사진이 대부분 감자·양파·배로 흘러들기 때문이다. 재현율로 판정하면 전복 사진에도
  "감자 같아요"가 뜬다(실측 재현율 100% 이므로 A 등급). 그래서 정밀도로만 판정한다.

  근거 수치는 전부 measured-accuracy.json 에 있다. 재측정하면 그 파일만 갈아끼운다.
*/
import { photoStateLabel, tierHeadline } from '../lib/confidence-tier-view.js';
import { josa, josaRo } from '../lib/korean.js';
import type { ConfidenceTier } from '../lib/confidence-tier-view.js';
import measured from './measured-accuracy.json' with { type: 'json' };

// 화면 문구는 브라우저와 공유하는 lib 한 곳에서만 온다(화면·TTS·서버가 같은 문장을 쓴다).
export { photoStateLabel, tierHeadline };
export type { ConfidenceTier };

export interface TierEvidence {
  measured_at: string;
  source: string;
  sample_total: number;
  conditions: string[];
  field_evaluated: boolean;
  /** 화면 '근거 보기' 에 항상 노출되는 한계 문구. 조건부로 숨기지 않는다. */
  caveats: string[];
}

export interface TierResult {
  tier: ConfidenceTier;
  /** 이 품목으로 판정했을 때 실제로 맞았던 비율(정밀도, 0~1). 단계 판정의 유일한 근거 */
  measured_precision: number | null;
  /** 참고용 재현율(진짜 이 품목을 맞힌 비율). 화면 문구에는 쓰지 않는다 */
  measured_recall: number | null;
  /** 이 품목으로 판정한 횟수 */
  sample_n: number | null;
  /** 화면 '근거 보기' 에 그대로 출력하는 한 줄 */
  reason: string;
  evidence: TierEvidence;
}

export interface TierInput {
  /** 판정을 낸 프로바이더 이름 (heuristic / cnn / mock / openai …) */
  provider: string;
  product: string;
  productKo: string;
  candidateCount: number;
  /** quality-analysis 의 signalQuality (0~1) */
  signalQuality: number;
  detectedIssues: string[];
}

export const MEASURED = measured;

/** 품목 한 칸의 실측치. precision 이 null 이면 그 품목으로 판정된 적이 한 번도 없다는 뜻. */
export interface ItemMeasurement {
  precision: number | null;
  predicted_n: number;
  correct_n: number;
  recall: number;
}

/** 실측표를 가진 프로바이더만 추측을 화면에 내밀 수 있다. */
const TABLES: Record<string, Record<string, ItemMeasurement>> = {
  heuristic: measured.heuristic as Record<string, ItemMeasurement>,
  cnn: measured.cnn as Record<string, ItemMeasurement>,
};

/** 실측 재현율 0% 품목 — 색표·학습 어휘 밖이라 한 번도 맞힌 적이 없는 8종. */
export const ZERO_HIT_ITEMS: string[] = Object.entries(
  measured.heuristic as Record<string, ItemMeasurement>,
)
  .filter(([, m]) => m.recall === 0)
  .map(([code]) => code);

const EVIDENCE: TierEvidence = {
  measured_at: measured.measured_at,
  source: measured.source,
  sample_total: measured.sample_total,
  conditions: measured.conditions,
  field_evaluated: measured.field_evaluated,
  caveats: measured.caveats,
};



/**
 * 단계 판정. A 로 올라가는 길은 좁고 C 로 떨어지는 길은 넓다 — 의도된 비대칭이다.
 * 틀린 확신의 비용이 "모르겠다" 의 비용보다 훨씬 크기 때문이다.
 */
export function resolveTier(input: TierInput): TierResult {
  const base = (
    tier: ConfidenceTier,
    reason: string,
    m: ItemMeasurement | null,
  ): TierResult => ({
    tier,
    measured_precision: m?.precision ?? null,
    measured_recall: m?.recall ?? null,
    sample_n: m ? m.predicted_n : null,
    reason,
    evidence: EVIDENCE,
  });

  // 1. 후보 자체가 없으면 추측할 것이 없다.
  if (!input.product || input.candidateCount === 0) {
    return base('unknown', '사진에서 품목 후보를 찾지 못했습니다.', null);
  }

  // 2. 이 프로바이더가 이 품목이라고 말했을 때 실제로 맞았던 비율만 본다.
  //    표가 아예 없는 프로바이더(mock·외부 API)는 근거가 없으므로 추측을 내밀지 않는다.
  const table = TABLES[input.provider];
  const m = table?.[input.product];
  if (!m) {
    return base('unknown', '이 품목은 아직 사진으로 시험해 보지 못했습니다.', null);
  }

  const name = input.productKo || input.product;

  // 재현율 0% 품목(색표·학습 어휘 밖 8종)은 판정으로 나올 수조차 없다. 나왔다면 표가 낡은 것이다.
  if (m.precision === null || m.recall === 0) {
    return base(
      'unknown',
      `${name}${josa(name, '은', '는')} 사진으로 맞힌 적이 한 번도 없습니다 (${measured.sample_per_item}번 중 0번).`,
      m,
    );
  }

  const ro = josaRo(name);
  const ida = josa(name, '이었습니다', '였습니다');
  const hitLine = `${name} — 사진을 ${name}${ro} 본 ${m.predicted_n}번 중 ${m.correct_n}번이 실제 ${name}${ida}.`;
  const t = measured.tiers;

  // 3. 맞힌 적이 거의 없으면 추측을 아예 내밀지 않는다(C).
  //    틀릴 게 확실한 추측을 보여주는 건 도움이 아니라 해다.
  if (m.precision < t.unknown_max) {
    return base(
      'unknown',
      `이 사진을 ${name}${josaRo(name)} 봤지만, ${name}${josaRo(name)} 본 ${m.predicted_n}번 중 실제 ${name}${josa(name, '은', '는')} ${m.correct_n}번뿐이었습니다.`,
      m,
    );
  }

  if (m.precision < t.likely_min) return base('unsure', hitLine, m);

  // 4. 사진 신호가 나쁘면 강등한다.
  //    근거: 같은 heuristic 이 '학습과 같은 조건' 50% → '흙·상자 배경' 16% 로 무너진다
  //    (outputs/provider_comparison.txt, A·B 두 축소 방식 모두 동일).
  if (input.signalQuality < t.min_signal_quality || input.detectedIssues.length > 0) {
    return base('unsure', `${hitLine} 다만 이 사진은 상태가 좋지 않습니다.`, m);
  }

  // 삭제한 규칙: "1순위와 2순위 확률 차 < 0.10 이면 B 로 강등".
  // 측정으로 확인되지 않았다. A 후보 8품목에서 임계 0.05 는 접전 쪽이 오히려 높고(91.7% vs 89.1%),
  // 0.10 에서만 낮으며(83.7% vs 93.7%), 0.15 에서 다시 좁혀진다(88.7% vs 92.8%) — 단조롭지 않다.
  // 품목 안에서 보면 방향이 아예 뒤집힌다(배: 접전 100% vs 비접전 0%, 감자·양파는 차이 없음).
  // 유효 독립표본이 품목 8개뿐이라 이 -10p 는 임계값을 고른 결과일 뿐이다.
  // 무엇보다 이 규칙은 정보 없음이 증명된 그 confidence 숫자에 다시 기대고 있다. 그래서 넣지 않는다.
  return base('likely', hitLine, m);
}
