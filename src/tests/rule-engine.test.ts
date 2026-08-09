import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideFlow, THRESHOLD_AUTO, THRESHOLD_CHOOSE } from '../ai/rule-engine.js';
import type { RecognitionResult } from '../ai/types.js';

function recognition(overrides: Partial<RecognitionResult> = {}): RecognitionResult {
  return {
    category: 'fruit',
    product: 'pear',
    product_ko: '배',
    variety_guess: '신고배',
    quality_hint: '상',
    confidence: 0.9,
    detected_issues: [],
    description_basis: [],
    alternatives: [{ product: 'apple', product_ko: '사과', confidence: 0.2 }],
    ...overrides,
  };
}

describe('룰 엔진 — AI 가 판매를 막지 않는다', () => {
  it('신뢰도가 높으면 바로 확인 화면으로 간다', () => {
    const d = decideFlow(recognition({ confidence: THRESHOLD_AUTO }), true);
    assert.equal(d.mode, 'auto');
    assert.match(d.headline, /배/);
  });

  it('1·2순위가 붙어 있으면 두 개 중 고르게 한다', () => {
    const d = decideFlow(
      recognition({ confidence: 0.6, alternatives: [{ product: 'apple', product_ko: '사과', confidence: 0.52 }] }),
      true,
    );
    assert.equal(d.mode, 'choose');
    assert.deepEqual(d.options, ['pear', 'apple']);
    assert.match(d.headline, /사과/);
  });

  it('절대 신뢰도가 낮아도 2순위와 크게 벌어지면 하나만 제시한다', () => {
    const d = decideFlow(
      recognition({ confidence: 0.63, alternatives: [{ product: 'apple', product_ko: '사과', confidence: 0.19 }] }),
      true,
    );
    assert.equal(d.mode, 'auto');
    assert.match(d.reason, /격차/);
  });

  it('격차가 커도 신뢰도 자체가 바닥이면 하나만 제시하지 않는다', () => {
    const d = decideFlow(
      recognition({ confidence: 0.47, alternatives: [{ product: 'apple', product_ko: '사과', confidence: 0.05 }] }),
      true,
    );
    assert.equal(d.mode, 'choose');
  });

  it('신뢰도가 낮으면 직접 고르게 한다', () => {
    const d = decideFlow(
      recognition({ confidence: THRESHOLD_CHOOSE - 0.01, alternatives: [{ product: 'apple', product_ko: '사과', confidence: 0.2 }] }),
      true,
    );
    assert.equal(d.mode, 'manual');
  });

  it('품목을 못 정했으면 직접 선택으로 보낸다', () => {
    const d = decideFlow(recognition({ product: '', product_ko: '', confidence: 0 }), true);
    assert.equal(d.mode, 'manual');
  });

  it('표준 SKU 가 없으면 신뢰도가 높아도 자동 진행하지 않는다', () => {
    const d = decideFlow(recognition({ confidence: 0.99 }), false);
    assert.equal(d.mode, 'manual');
    assert.match(d.reason, /SKU/);
  });
});
