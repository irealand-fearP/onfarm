import type { RecognitionResult } from './types.js';

export const THRESHOLD_AUTO = 0.75;
export const THRESHOLD_CHOOSE = 0.45;
/** 1순위가 이 정도 신뢰도를 넘고 2순위와 충분히 벌어지면 하나만 제시한다. */
export const THRESHOLD_MARGIN_BASE = 0.5;
export const THRESHOLD_MARGIN_GAP = 0.25;

export type FlowMode =
  /** 바로 확인 화면으로 (농민은 '맞아요' 한 번만 누르면 됨) */
  | 'auto'
  /** 후보 2~3개를 큰 버튼으로 고르게 */
  | 'choose'
  /** 품목을 직접 큰 버튼으로 고르게 (AI 실패해도 판매는 계속된다) */
  | 'manual';

export interface FlowDecision {
  mode: FlowMode;
  /** 화면 맨 위에 읽어줄 한 문장 */
  headline: string;
  /** 큰 버튼으로 제시할 품목 코드들 (choose 모드에서 사용) */
  options: string[];
  /** 왜 이 모드가 됐는지 (개발자/심사용 설명) */
  reason: string;
}

/**
 * 신뢰도와 이슈를 보고 '농민에게 무엇을 시킬지'를 정한다.
 * 핵심 원칙: AI 가 틀리거나 실패해도 판매 흐름이 멈추지 않는다.
 */
export function decideFlow(recognition: RecognitionResult, hasSku: boolean): FlowDecision {
  const name = recognition.product_ko;

  if (!recognition.product || !hasSku) {
    return {
      mode: 'manual',
      headline: '사진을 자동으로 확인하지 못했습니다. 무엇을 파실까요?',
      options: [],
      reason: !recognition.product ? '품목 미확정' : '해당 품목의 표준 SKU 미등록',
    };
  }

  const runnerUp = (recognition.alternatives ?? [])[0]?.confidence ?? 0;
  const margin = recognition.confidence - runnerUp;

  if (recognition.confidence >= THRESHOLD_AUTO) {
    return {
      mode: 'auto',
      headline: `${name}(으)로 보입니다.`,
      options: [recognition.product],
      reason: `신뢰도 ${recognition.confidence.toFixed(2)} ≥ ${THRESHOLD_AUTO}`,
    };
  }

  // 절대 신뢰도는 낮아도 2순위와 확실히 벌어져 있으면 하나만 제시한다.
  // (어차피 농민이 '맞아요'를 눌러 확인하므로, 선택지를 늘리는 게 오히려 부담이다)
  if (recognition.confidence >= THRESHOLD_MARGIN_BASE && margin >= THRESHOLD_MARGIN_GAP) {
    return {
      mode: 'auto',
      headline: `${name}(으)로 보입니다.`,
      options: [recognition.product],
      reason: `신뢰도 ${recognition.confidence.toFixed(2)}, 2순위와 격차 ${margin.toFixed(2)} ≥ ${THRESHOLD_MARGIN_GAP}`,
    };
  }

  if (recognition.confidence >= THRESHOLD_CHOOSE) {
    const alt = (recognition.alternatives ?? [])[0];
    const options = [recognition.product];
    if (alt) options.push(alt.product);
    const altName = alt?.product_ko;
    return {
      mode: 'choose',
      headline: altName
        ? `${name}인지 ${altName}인지 확실하지 않습니다.`
        : `${name}인지 확실하지 않습니다.`,
      options,
      reason: `신뢰도 ${recognition.confidence.toFixed(2)} 가 ${THRESHOLD_AUTO} 미만`,
    };
  }

  return {
    mode: 'manual',
    headline: '사진을 자동으로 확인하지 못했습니다. 무엇을 파실까요?',
    options: [],
    reason: `신뢰도 ${recognition.confidence.toFixed(2)} 가 ${THRESHOLD_CHOOSE} 미만`,
  };
}
