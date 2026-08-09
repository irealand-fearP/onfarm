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

/** 20260809-3F2A 형태의 주문번호 */
export function orderNo(now: Date = new Date(), rand: () => number = Math.random): string {
  const d = todayKst(now).replace(/-/g, '');
  const suffix = Math.floor(rand() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `${d}-${suffix}`;
}
