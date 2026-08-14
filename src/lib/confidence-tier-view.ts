/*
  신뢰 단계의 '말' 을 담는 단일 출처.

  왜 lib 에 있나: 화면(h1)과 TTS 가 글자 단위로 같은 문장을 써야 하고, 서버 테스트도 같은 문장을
  검증해야 한다. 세 곳에 따로 타이핑하면 반드시 어긋나므로 여기 한 곳만 보게 한다.
  (korean.ts·sell-steps.ts 와 같은 방식: dist/lib → 브라우저에는 /js/shared/ 로 내려간다)
*/

export type ConfidenceTier = 'likely' | 'unsure' | 'unknown';

/**
 * A 는 평서형, B 는 의문형, C 는 고백형.
 * 문장 종결어미만으로 확신도가 전달되게 한다 — 색·아이콘으로 단계를 구분하지 않는다.
 */
export function tierHeadline(tier: ConfidenceTier, productKo = ''): { title: string; sub: string } {
  if (tier === 'likely') return { title: `${productKo} 같아요`, sub: '맞으면 눌러 주세요' };
  if (tier === 'unsure') return { title: `혹시 ${productKo}인가요?`, sub: '아니면 아래에서 골라 주세요' };
  return { title: '사진으로는 잘 모르겠어요', sub: '무엇을 파실지 직접 골라 주세요' };
}

/**
 * 사진 상태 배지 문구. 주어를 '사진' 으로 못 박는다.
 * 기존 "AI 품질 참고: 상" 은 어르신이 농산물 등급으로 읽어, "AI 는 등급을 확정하지 않는다" 는
 * 원칙과 정면으로 헷갈렸다. 그래서 전 화면에서 그 표현을 폐기한다.
 */
export function photoStateLabel(qualityHint: string, issues: string[] = []): string {
  if (qualityHint === '상') return '좋음';
  if (qualityHint === '보통') return '보통';
  if (issues.some((i) => i.includes('어두'))) return '어두움';
  return '확인 필요';
}
