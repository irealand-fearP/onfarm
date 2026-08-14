/*
  판매 등록 3단계(사진 → 품목 → 수량)의 단일 출처.
  홈(안내 인디케이터)과 등록 화면(.prog)이 라벨을 각자 타이핑하면 반드시 어긋나므로
  여기 한 곳만 보게 한다. 서버 코드는 쓰지 않지만 dist/lib 로 컴파일돼
  브라우저에는 /js/shared/sell-steps.js 로 그대로 내려간다(korean.ts 와 같은 방식).
*/

export type StepProgress = {
  /** 화면에 찍는 '1 / 3' 표기 */
  step: string;
  label: string;
  /** 안내 OFF 힌트(현행) */
  hint: string;
  /** 안내 ON 힌트 — 행동 지시형 */
  hintGuide: string;
  /** 진행 바 % */
  value: number;
};

export const STEP_PROGRESS = {
  stepPhoto: {
    step: '1 / 3',
    label: '사진 찍기',
    hint: '한 장이면 됩니다',
    hintGuide: '농산물이 꽉 차게 한 장 찍어 주세요',
    value: 33,
  },
  stepLoading: {
    step: '1 / 3',
    label: '사진 확인 중',
    hint: '잠시만요',
    hintGuide: '잠시만요',
    value: 33,
  },
  stepResult: {
    step: '2 / 3',
    label: '품목 고르기',
    hint: '거의 다 됐어요',
    hintGuide: '맞는 것을 눌러 주세요',
    value: 66,
  },
  stepManual: {
    step: '2 / 3',
    label: '품목 고르기',
    hint: '거의 다 됐어요',
    hintGuide: '목록에서 골라 주세요',
    value: 66,
  },
  stepSku: {
    step: '3 / 3',
    label: '수량 확인',
    hint: '마지막이에요',
    hintGuide: '수량만 맞으면 끝입니다',
    value: 100,
  },
  stepDone: {
    step: '완료',
    label: '판매 등록 완료',
    hint: '',
    hintGuide: '',
    value: 100,
  },
} satisfies Record<string, StepProgress>;

/**
 * 안내 인디케이터 3칸.
 * short 는 밀도 '보통'(좁은 폭)에서 줄바꿈이 나지 않도록 쓰는 축약 라벨.
 */
export const GUIDE_STEPS = [
  { no: 1, label: '사진', short: '사진' },
  { no: 2, label: '품목 확인', short: '품목' },
  { no: 3, label: '수량 확인', short: '수량' },
];

/*
  단계별 '지금 할 일' — 홈에서 시작된 강조가 등록 화면 끝까지 끊기지 않게 한다.
  진행 표시(①②③)는 "어디쯤 왔나"만 알려줄 뿐 "어디를 눌러야 하나"를 못 알려준다.
  그래서 단계마다 주 조작 하나만 골라 홈과 같은 초록 강조 + 배지를 얹는다.
  설계 원칙 3(가리키는 곳은 한 화면에 하나)을 지키려고 target 은 반드시 한 개다.
*/
export type StepFocus = {
  /** 강조할 주 조작 하나(CSS 선택자). null 이면 사용자가 할 일이 없는 단계. */
  target: string | null;
  /** 행동 지시 한 줄. 방향어는 화면 배치(문구가 대상 아래냐 위냐) 기준으로 쓴다. */
  hint: string;
};

const STEP_FOCUS: Record<string, StepFocus> = {
  // 사진 칸이 이 화면의 유일한 조작이다('시연' 버튼은 발표자용 보조 수단).
  stepPhoto: {
    target: '#stepPhoto .photo-drop',
    hint: '위의 큰 사진 칸을 눌러 사진을 찍어 주세요',
  },
  // 기다리는 단계라 강조 대상이 없다. 문구도 지시가 아니라 안심시키는 말로 둔다.
  stepLoading: { target: null, hint: '사진을 살펴보는 중입니다. 잠시만 기다려 주세요' },
  // 후보 '목록'을 가리킨다. AI 1순위 카드만 강조하면 'AI가 고른 게 정답'으로 읽혀
  // 판단은 사람이 한다는 원칙에 어긋난다.
  stepResult: { target: '#candidateGrid', hint: '위 목록에서 사진과 같은 것을 눌러 주세요' },
  stepManual: { target: '#manualGrid', hint: '위 목록에서 파실 농산물을 눌러 주세요' },
  // 마이크·＋−·확인 버튼이 한 화면에 있다. 순서상 수량을 '정하는' 게 먼저이므로
  // 스테퍼를 가리키고, 다음 행동인 '이대로 팔기'는 문구로만 예고한다.
  stepSku: {
    target: '#stepSku .stepper',
    hint: '위 ＋ − 를 눌러 수량을 정한 뒤, 맨 아래 ‘이대로 팔기’를 눌러 주세요',
  },
  stepDone: { target: '#doneAgain', hint: '아래 ‘하나 더 올리기’를 누르면 계속 등록합니다' },
};

/** 이 단계에서 어디를 강조하고 무엇을 안내할지. 모르는 단계면 아무것도 하지 않는다. */
export function stepFocus(step: string): StepFocus {
  return STEP_FOCUS[step] ?? { target: null, hint: '' };
}

/** 진행률(33/66/100) → 현재 칸 인덱스(0·1·2). 범위를 벗어나면 양끝으로 붙인다. */
export function guideStepIndex(value: number): number {
  if (value >= 100) return 2;
  if (value >= 66) return 1;
  return 0;
}
