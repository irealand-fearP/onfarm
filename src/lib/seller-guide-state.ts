/*
  안내(따라 하기) 모드의 판정 로직만 모은 순수 모듈.
  localStorage 접근·DOM 조작은 브라우저 쪽(web/js/seller-guide.js)이 맡고,
  "무엇이 켜짐인가 / 언제 졸업인가" 판단은 여기서만 한다(테스트 가능하게).
  브라우저에는 /js/shared/seller-guide-state.js 로 내려간다.
*/

export type GuideState = 'on' | 'off';

export const GUIDE_KEYS = {
  /** 안내 모드 상태 */
  state: 'onfarm.seller.guide',
  /** 사용자가 토글을 직접 누른 적 있음 → 자동 졸업 안 함 */
  manual: 'onfarm.seller.guide.manual',
  /** 등록 완료 횟수 */
  count: 'onfarm.seller.sellCount',
  /** 졸업 안내 줄을 한 번만 보여주기 위한 대기 플래그 */
  notice: 'onfarm.seller.guide.notice',
} as const;

/** 자동 졸업에 필요한 등록 완료 횟수 */
export const GRADUATE_AT = 3;

/** 저장값이 'off' 일 때만 꺼짐. 없음·이상값은 전부 켜짐(첫 방문 ON). */
export function resolveGuideState(stored: string | null | undefined): GuideState {
  return stored === 'off' ? 'off' : 'on';
}

/** 저장된 횟수에 1을 더한다. 이상값·음수는 0에서 다시 센다. */
export function nextSellCount(stored: string | null | undefined): number {
  const parsed = Number.parseInt(String(stored ?? ''), 10);
  const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return current + 1;
}

export type GraduateInput = {
  count: number;
  /** 사용자가 토글을 직접 만졌는가 */
  manual: boolean;
  guide: GuideState;
  /** 시연(데모) 모드인가 — 발표 도중 안내가 꺼지면 안 되므로 졸업을 막는다 */
  demoMode: boolean;
};

/** 지금 안내를 자동으로 내려야 하는가. */
export function shouldGraduate({ count, manual, guide, demoMode }: GraduateInput): boolean {
  if (demoMode) return false;
  if (manual) return false;
  if (guide !== 'on') return false;
  return count >= GRADUATE_AT;
}
