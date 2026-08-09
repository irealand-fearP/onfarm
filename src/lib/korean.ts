/**
 * 음성 입력("다섯 박스", "열두 상자")을 수량으로 바꾼다.
 * 고령 사용자는 숫자 버튼보다 말이 편한 경우가 많아 폴백이 아니라 1급 입력으로 다룬다.
 */
const NATIVE_ONES: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 서: 3, 네: 4, 넷: 4, 너: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50,
};

const SINO: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10,
};

const TENS = ['열', '스물', '서른', '마흔', '쉰'];
const ONES = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];

/**
 * @returns 1 이상 999 이하의 수량, 못 알아들으면 null
 */
export function parseKoreanQuantity(input: string): number | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, '');

  // 1) 아라비아 숫자가 있으면 그것을 우선한다.
  const digits = text.match(/\d+/);
  if (digits) {
    const n = Number(digits[0]);
    return n >= 1 && n <= 999 ? n : null;
  }

  // 2) 고유어 십단위 + 일단위 (열두, 스물다섯 ...)
  for (let t = 0; t < TENS.length; t += 1) {
    const tens = TENS[t];
    if (tens && text.includes(tens)) {
      const base = (t + 1) * 10;
      const rest = text.slice(text.indexOf(tens) + tens.length);
      for (let o = 0; o < ONES.length; o += 1) {
        const one = ONES[o];
        if (one && rest.startsWith(one)) return base + o + 1;
      }
      // '열두' 처럼 축약형
      if (rest.startsWith('두')) return base + 2;
      return base;
    }
  }

  // 3) 단독 고유어 수사
  for (const [word, value] of Object.entries(NATIVE_ONES)) {
    if (text.startsWith(word)) return value;
  }

  // 4) 한자어 수사(일, 이, 삼 ...) — 단위어가 붙은 경우만 인정해 오인식을 줄인다.
  const sinoMatch = text.match(/^([영공일이삼사오육칠팔구십]+)(상자|박스|개|봉|망|포)/);
  if (sinoMatch?.[1]) {
    const word = sinoMatch[1];
    if (word.length === 1) {
      const v = SINO[word];
      return v !== undefined && v >= 1 ? v : null;
    }
    if (word.startsWith('십')) {
      const rest = word.slice(1);
      const r = rest ? SINO[rest] : 0;
      return 10 + (r ?? 0);
    }
    const parts = word.split('십');
    if (parts.length === 2) {
      const tenPart = parts[0] ? SINO[parts[0]] : 1;
      const onePart = parts[1] ? SINO[parts[1]] : 0;
      if (tenPart !== undefined) return tenPart * 10 + (onePart ?? 0);
    }
  }

  return null;
}

/** 30000 → "3만 원" 같은 자연스러운 낭독 문자열 */
export function speakPrice(won: number): string {
  if (won < 10_000) return `${won.toLocaleString('ko-KR')}원`;
  const man = Math.floor(won / 10_000);
  const rest = won % 10_000;
  if (rest === 0) return `${man}만 원`;
  if (rest % 1000 === 0) return `${man}만 ${rest / 1000}천 원`;
  return `${man}만 ${rest.toLocaleString('ko-KR')}원`;
}

/** 무게 낭독: 5 → "5킬로그램" */
export function speakWeight(weight: number, unit: string): string {
  const unitKo = unit === 'kg' ? '킬로그램' : unit === 'g' ? '그램' : unit;
  return `${weight}${unitKo}`;
}
