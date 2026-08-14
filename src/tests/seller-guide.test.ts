import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GUIDE_KEYS,
  nextSellCount,
  resolveGuideState,
  shouldGraduate,
} from '../lib/seller-guide-state.js';
import { GUIDE_STEPS, STEP_PROGRESS, guideStepIndex } from '../lib/sell-steps.js';

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

  it('저장 키 이름이 고정돼 있다', () => {
    assert.equal(GUIDE_KEYS.state, 'onfarm.seller.guide');
    assert.equal(GUIDE_KEYS.manual, 'onfarm.seller.guide.manual');
    assert.equal(GUIDE_KEYS.count, 'onfarm.seller.sellCount');
    assert.equal(GUIDE_KEYS.notice, 'onfarm.seller.guide.notice');
  });
});
