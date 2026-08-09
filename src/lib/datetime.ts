const KST = 'Asia/Seoul';

/** YYYY-MM-DD (한국 시간 기준) */
export function todayKst(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA 는 YYYY-MM-DD 형식
}

/**
 * 20260809-3F2A9C 형태의 주문번호.
 * 4자리(65,536공간)로는 하루 1,000건에서 충돌 확률이 사실상 100%라 6자리(1,677만)로 넓혔다.
 * 그래도 충돌은 가능하므로 호출부에서 재시도한다.
 */
export function orderNo(now: Date = new Date(), rand: () => number = Math.random): string {
  const d = todayKst(now).replace(/-/g, '');
  const suffix = Math.floor(rand() * 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, '0');
  return `${d}-${suffix}`;
}
