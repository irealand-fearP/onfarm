import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GUIDE_KEYS,
  nextSellCount,
  resolveGuideState,
  shouldGraduate,
} from '../lib/seller-guide-state.js';
import { GUIDE_STEPS, STEP_PROGRESS, guideStepIndex, stepFocus } from '../lib/sell-steps.js';

describe('안내 모드 상태 해석', () => {
  it('저장값이 없으면 켜짐이다(첫 방문 ON)', () => {
    assert.equal(resolveGuideState(null), 'on');
    assert.equal(resolveGuideState(''), 'on');
  });

  it("'off' 일 때만 꺼짐이고 이상값은 켜짐으로 본다", () => {
    assert.equal(resolveGuideState('off'), 'off');
    assert.equal(resolveGuideState('on'), 'on');
    assert.equal(resolveGuideState('이상값'), 'on');
  });

  it('등록 완료 횟수는 1씩 늘고 이상값은 1부터 다시 센다', () => {
    assert.equal(nextSellCount(null), 1);
    assert.equal(nextSellCount('2'), 3);
    assert.equal(nextSellCount('숫자아님'), 1);
    assert.equal(nextSellCount('-5'), 1);
  });
});

describe('자동 졸업 판정', () => {
  const base = { count: 3, manual: false, guide: 'on' as const, demoMode: false };

  it('3회 완료하면 졸업한다', () => {
    assert.equal(shouldGraduate(base), true);
  });

  it('2회까지는 졸업하지 않는다', () => {
    assert.equal(shouldGraduate({ ...base, count: 2 }), false);
  });

  it('사용자가 토글을 직접 만졌으면 졸업하지 않는다', () => {
    assert.equal(shouldGraduate({ ...base, manual: true }), false);
  });

  it('이미 꺼져 있으면 졸업 처리를 하지 않는다', () => {
    assert.equal(shouldGraduate({ ...base, guide: 'off' }), false);
  });

  it('시연 모드에서는 3회여도 졸업하지 않는다(발표 중 안내가 꺼지면 안 된다)', () => {
    assert.equal(shouldGraduate({ ...base, demoMode: true }), false);
    assert.equal(shouldGraduate({ ...base, count: 9, demoMode: true }), false);
  });

  it('데모 초기화로 카운터가 0이 되면 다시 졸업하지 않는다', () => {
    assert.equal(shouldGraduate({ ...base, count: 0 }), false);
    assert.equal(nextSellCount('0'), 1);
  });
});

describe('단계 라벨 단일 출처', () => {
  it('홈과 등록 화면이 같은 3단계 라벨을 쓴다', () => {
    assert.deepEqual(
      GUIDE_STEPS.map((s) => s.label),
      ['사진', '품목 확인', '수량 확인'],
    );
    assert.deepEqual(
      GUIDE_STEPS.map((s) => s.short),
      ['사진', '품목', '수량'],
    );
  });

  it('진행률 값으로 현재 칸을 판정한다', () => {
    assert.equal(guideStepIndex(STEP_PROGRESS.stepPhoto.value), 0);
    assert.equal(guideStepIndex(STEP_PROGRESS.stepLoading.value), 0);
    assert.equal(guideStepIndex(STEP_PROGRESS.stepResult.value), 1);
    assert.equal(guideStepIndex(STEP_PROGRESS.stepManual.value), 1);
    assert.equal(guideStepIndex(STEP_PROGRESS.stepSku.value), 2);
  });

  it('안내 ON 힌트는 행동 지시형으로 따로 있다', () => {
    assert.equal(STEP_PROGRESS.stepPhoto.hint, '한 장이면 됩니다');
    assert.equal(STEP_PROGRESS.stepPhoto.hintGuide, '농산물이 꽉 차게 한 장 찍어 주세요');
    assert.equal(STEP_PROGRESS.stepSku.hintGuide, '수량만 맞으면 끝입니다');
    assert.equal(STEP_PROGRESS.stepLoading.hintGuide, STEP_PROGRESS.stepLoading.hint);
  });

  it('안내 ON 힌트는 행동 지시형으로 따로 있다 (진행 줄용)', () => {
    assert.equal(STEP_PROGRESS.stepResult.hintGuide, '맞는 것을 눌러 주세요');
  });

  it('저장 키 이름이 고정돼 있다', () => {
    assert.equal(GUIDE_KEYS.state, 'onfarm.seller.guide');
    assert.equal(GUIDE_KEYS.manual, 'onfarm.seller.guide.manual');
    assert.equal(GUIDE_KEYS.count, 'onfarm.seller.sellCount');
    assert.equal(GUIDE_KEYS.notice, 'onfarm.seller.guide.notice');
  });
});

describe('등록 화면 단계별 강조 대상', () => {
  const ACT_STEPS = ['stepPhoto', 'stepResult', 'stepManual', 'stepSku', 'stepDone'] as const;

  it('사용자가 할 일이 있는 단계마다 강조 대상이 정확히 하나다', () => {
    for (const step of ACT_STEPS) {
      const focus = stepFocus(step);
      assert.equal(typeof focus.target, 'string', `${step} 에 강조 대상이 없다`);
      assert.ok(focus.target && focus.target.length > 0);
    }
  });

  it('강조 대상은 단계마다 서로 다른 요소다(시선 경합 방지)', () => {
    const targets = ACT_STEPS.map((s) => stepFocus(s).target);
    assert.equal(new Set(targets).size, targets.length);
  });

  it('각 단계의 주 조작은 그 단계 안에 있는 요소를 가리킨다', () => {
    assert.equal(stepFocus('stepPhoto').target, '#stepPhoto .photo-drop');
    assert.equal(stepFocus('stepResult').target, '#candidateGrid');
    assert.equal(stepFocus('stepManual').target, '#manualGrid');
    // 수량은 '정하기'가 먼저다 — 확인 버튼(#submitBtn)이 아니라 스테퍼를 가리킨다.
    assert.equal(stepFocus('stepSku').target, '#stepSku .stepper');
    assert.equal(stepFocus('stepDone').target, '#doneAgain');
  });

  it('분석 중에는 할 일이 없으므로 강조하지 않는다', () => {
    assert.equal(stepFocus('stepLoading').target, null);
    assert.ok(stepFocus('stepLoading').hint.length > 0);
  });

  it('모든 단계에 행동 지시 한 줄이 있다', () => {
    for (const step of [...ACT_STEPS, 'stepLoading']) {
      assert.ok(stepFocus(step).hint.length > 0, `${step} 안내 문구 없음`);
    }
  });

  it('강조가 있는 단계의 문구는 방향어와 함께 무엇을 누를지 말한다', () => {
    for (const step of ACT_STEPS) {
      const { hint } = stepFocus(step);
      assert.match(hint, /위|아래/, `${step}: 방향어 없음 — ${hint}`);
      assert.match(hint, /눌러|누르면/, `${step}: 조작 지시 없음 — ${hint}`);
    }
  });

  it('모르는 단계는 아무것도 강조하지 않는다', () => {
    assert.deepEqual(stepFocus('없는단계'), { target: null, hint: '' });
  });
});
