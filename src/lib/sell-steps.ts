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

/** 진행률(33/66/100) → 현재 칸 인덱스(0·1·2). 범위를 벗어나면 양끝으로 붙인다. */
export function guideStepIndex(value: number): number {
  if (value >= 100) return 2;
  if (value >= 66) return 1;
  return 0;
}
