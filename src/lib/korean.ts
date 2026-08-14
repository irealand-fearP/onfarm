/**
 * 음성 입력("다섯 박스", "열두 상자")을 수량으로 바꾼다.
 * 고령 사용자는 숫자 버튼보다 말이 편한 경우가 많아 폴백이 아니라 1급 입력으로 다룬다.
 */
const NATIVE_ONES: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 서: 3, 네: 4, 넷: 4, 너: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  닷: 5, 엿: 6, // 어르신이 쓰는 옛 수사(닷 상자 = 다섯 상자)
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

  // 2) 문장 맨 앞에서 세 본다.
  const head = parseFromHead(text);
  if (head !== null) return head;

  // 3) STT 는 말 앞에 감탄사("어", "음")를 자주 붙인다 — 떼고 다시 본다.
  const stripped = stripFillers(text);
  if (stripped !== text) {
    const afterFiller = parseFromHead(stripped);
    if (afterFiller !== null) return afterFiller;
  }

  // 4) "사과 다섯 상자" 처럼 앞말이 붙은 문장 — 단위어 바로 앞의 수사를 찾는다.
  //    단위어가 반드시 있어야 인정하므로 엉뚱한 말이 수량으로 둔갑하지 않는다.
  return parseBeforeUnit(text);
}

/** STT 가 붙이는 군말. '네'·'예'는 수사(넷)와 헷갈려 일부러 넣지 않는다. */
const FILLERS = ['어', '음', '아', '그', '저', '에', '흠', '자', '이제', '오늘은'];

function stripFillers(text: string): string {
  let rest = text;
  for (let guard = 0; guard < FILLERS.length; guard += 1) {
    const hit = FILLERS.find((f) => rest.startsWith(f) && rest.length > f.length);
    if (!hit) break;
    rest = rest.slice(hit.length);
  }
  return rest;
}

const UNIT_WORDS = /(상자|박스|개|봉|망|포)/;

/** 수사 뒤에 올 수 있는 말 — 이 중 하나이거나 문장 끝일 때만 수량으로 본다. */
const ALLOWED_TAIL = /^(상자|박스|개|봉|망|포|요|만|정도|쯤|입니다|이요|예요|주세요|$)/;

function parseBeforeUnit(text: string): number | null {
  const found = text.match(UNIT_WORDS);
  if (!found || found.index === undefined) return null;
  const unitAt = found.index;
  // 단위어 앞 최대 4글자(스물다섯 = 4글자)까지 뒤로 물러나며 훑는다. 긴 쪽이 먼저다.
  for (let start = Math.max(0, unitAt - 4); start < unitAt; start += 1) {
    const value = parseFromHead(text.slice(start));
    if (value !== null) return value;
  }
  return null;
}

/** 문장 맨 앞이 수사인 경우만 해석한다(예전 규칙 2~4). */
function parseFromHead(text: string): number | null {
  if (!text) return null;

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

  // 3) 단독 고유어 수사.
  //    뒤에 단위어·말끝(요/입니다…)이 오거나 그것으로 문장이 끝날 때만 인정한다.
  //    ('네 알겠습니다' 의 '네' 가 4로 둔갑하던 오인식을 막는다)
  for (const [word, value] of Object.entries(NATIVE_ONES)) {
    if (!text.startsWith(word)) continue;
    if (ALLOWED_TAIL.test(text.slice(word.length))) return value;
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

/*
 * TTS 는 "1번"을 '한 번(once)'으로 읽어버려 번호가 횟수처럼 들린다.
 * 그래서 낭독 문장에는 숫자를 글자로 풀어서 넣는다.
 *  - 번호표: 한자어 수사 → "일번, 이번, 삼번"
 *  - 개수 세기: 고유어 수사 → "세 상자, 다섯 상자"
 */

const SINO_ONES = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

/** 1~99 를 한자어 수사로: 1→일, 12→십이, 30→삼십 */
export function sinoNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensWord = tens === 0 ? '' : tens === 1 ? '십' : `${SINO_ONES[tens]}십`;
  return `${tensWord}${SINO_ONES[ones] ?? ''}` || String(n);
}

const NATIVE_COUNT_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
const NATIVE_COUNT_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

/** 1~99 를 개수 세는 고유어 수사로: 3→세, 5→다섯, 12→열두, 20→스무, 21→스물한 */
export function nativeCount(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (n === 20) return '스무';
  return `${NATIVE_COUNT_TENS[tens] ?? ''}${NATIVE_COUNT_ONES[ones] ?? ''}` || String(n);
}

/**
 * 받침 유무에 따라 조사를 고른다. "감자(으)로", "감자은" 같은 표기는 어르신 화면에서
 * 기계가 쓴 문장처럼 읽히므로 쓰지 않는다.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.at(-1) ?? '';
  const code = last.charCodeAt(0);
  // 한글 음절이 아니면(숫자·영문) 보수적으로 받침 있는 쪽을 쓴다.
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return withFinal;
  return (code - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
}

/** '로/으로' 전용. 받침 ㄹ 은 '로' 를 쓴다(쌀로, 전복으로, 감자로). */
export function josaRo(word: string): string {
  const last = word.at(-1) ?? '';
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '으로';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}
