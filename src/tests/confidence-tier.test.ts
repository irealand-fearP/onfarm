/*
  신뢰 단계(A/B/C) 판정의 잠금 테스트.

  왜 순수 함수로 잠그는가: 이 판정은 "어떤 품목에 대해 AI 추측을 사용자 앞에 내미느냐"를 정한다.
  화면·프로바이더와 섞이면 회귀를 못 잡으므로, 표(measured-accuracy.json)와 규칙만 보는
  순수 함수로 떼어 두고 여기서 케이스를 고정한다.
*/
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEASURED,
  ZERO_HIT_ITEMS,
  photoStateLabel,
  resolveTier,
  tierHeadline,
} from '../ai/confidence-tier.js';

/** 사진 상태가 완벽하고 후보가 넉넉한 기본 입력. 각 테스트는 필요한 것만 덮어쓴다. */
function input(over: Partial<Parameters<typeof resolveTier>[0]> = {}) {
  return {
    provider: 'heuristic',
    product: 'potato',
    productKo: '감자',
    candidateCount: 3,
    signalQuality: 1,
    detectedIssues: [] as string[],
    ...over,
  };
}

describe('resolveTier — 실측 0% 품목은 추측을 내밀지 않는다', () => {
  it('실측 0% 8품목은 사진 상태가 완벽해도 전부 unknown(C)', () => {
    assert.equal(ZERO_HIT_ITEMS.length, 8);
    for (const code of ZERO_HIT_ITEMS) {
      const r = resolveTier(input({ product: code }));
      assert.equal(r.tier, 'unknown', `${code} 는 C 여야 한다`);
      assert.equal(r.measured_recall, 0);
      assert.equal(r.measured_precision, null);
    }
  });

  it('0% 품목 사진이 흘러드는 품목도 막힌다 — 게이트의 실제 효과', () => {
    // 전복 사진은 색표에 전복이 없어 '감자' 로 판정된다. 감자의 재현율은 100% 지만
    // 감자라고 말했을 때 실제 감자인 비율은 18% 뿐이다. 그래서 감자 판정은 C 로 떨어진다.
    const r = resolveTier(input({ product: 'potato', productKo: '감자' }));
    assert.equal(r.tier, 'unknown');
    assert.equal(r.measured_recall, 1);
    assert.ok((r.measured_precision ?? 1) < 0.3);
    assert.match(r.reason, /356번 중 실제 감자는 64번/);
  });

  it('0% 품목 목록이 카탈로그 코드와 정확히 일치한다', () => {
    assert.deepEqual(
      [...ZERO_HIT_ITEMS].sort(),
      ['abalone', 'garlic', 'grape', 'mackerel', 'persimmon', 'rice', 'shrimp', 'squid'].sort(),
    );
  });
});

describe('resolveTier — 단계 판정', () => {
  it('정밀도 0.70 이상 + 사진 상태 좋음 → likely(A)', () => {
    assert.equal(resolveTier(input({ product: 'peach' })).tier, 'likely'); // 1.00
    assert.equal(resolveTier(input({ product: 'apple' })).tier, 'likely'); // 0.98
    assert.equal(resolveTier(input({ product: 'red_pepper' })).tier, 'likely'); // 0.873
  });

  it('정밀도 0.30~0.70 은 unsure(B)', () => {
    for (const code of ['sweet_potato', 'mandarin', 'pear', 'onion']) {
      assert.equal(resolveTier(input({ product: code })).tier, 'unsure', code);
    }
  });

  it('signalQuality 0.5 미만이면 A 후보라도 unsure(B) 로 강등', () => {
    const r = resolveTier(input({ product: 'apple', signalQuality: 0.4 }));
    assert.equal(r.tier, 'unsure');
    assert.match(r.reason, /사진/);
  });

  it('사진 문제(detected_issues)가 하나라도 있으면 unsure(B) 로 강등', () => {
    const r = resolveTier(input({ product: 'apple', detectedIssues: ['사진이 어두워 외관 확인이 어렵습니다.'] }));
    assert.equal(r.tier, 'unsure');
  });

  it('후보가 없거나 품목이 비면 unknown(C)', () => {
    assert.equal(resolveTier(input({ candidateCount: 0 })).tier, 'unknown');
    assert.equal(resolveTier(input({ product: '' })).tier, 'unknown');
  });

  it('표에 없는 품목(미측정)은 unknown(C)', () => {
    assert.equal(resolveTier(input({ product: 'dragonfruit' })).tier, 'unknown');
  });

  it('CNN 은 학습 5품목 밖이면 사진이 좋아도 unknown(C)', () => {
    // 미학습 11품목의 CNN top-1 은 모든 신뢰도 구간에서 0.0% (confidence_calibration.txt)
    assert.equal(resolveTier(input({ provider: 'cnn', product: 'sweet_potato' })).tier, 'unknown');
    // 학습 5품목이라도 정밀도가 낮으면 그대로 떨어진다(감귤 18.6%).
    assert.equal(resolveTier(input({ provider: 'cnn', product: 'mandarin' })).tier, 'unknown');
    assert.equal(resolveTier(input({ provider: 'cnn', product: 'pear' })).tier, 'likely');
  });

  it('실측이 없는 프로바이더(mock/외부 API)는 unknown(C)', () => {
    assert.equal(resolveTier(input({ provider: 'mock' })).tier, 'unknown');
  });

  it('접전(1·2순위 확률 차) 은 판정에 쓰지 않는다 — 입력 자체를 받지 않는다', () => {
    // 측정에서 유효성이 확인되지 않아 삭제한 규칙. 인자를 넣어도 결과가 달라지지 않아야 한다.
    const withGap = resolveTier({ ...input({ product: 'peach' }), topGap: 0.001 } as never);
    assert.equal(withGap.tier, 'likely');
  });
});

describe('resolveTier — 근거(evidence)', () => {
  it('한계 문구(caveats)는 모든 단계에서 항상 실려 나간다', () => {
    for (const code of ['potato', 'apple', 'rice']) {
      const r = resolveTier(input({ product: code }));
      assert.ok(r.evidence.caveats.length >= 2);
      assert.equal(r.evidence.field_evaluated, false);
      assert.ok(r.evidence.caveats.some((c) => c.includes('0장')));
      assert.equal(r.evidence.measured_at, MEASURED.measured_at);
    }
  });

  it('0% 품목의 reason 은 "64번 중 0번" 을 그대로 말한다', () => {
    const r = resolveTier(input({ product: 'abalone', productKo: '전복' }));
    assert.match(r.reason, /64번/);
    assert.match(r.reason, /0번/);
  });

  it('조사를 받침에 맞춰 붙인다 — "감자(으)로" 같은 기계 문장을 쓰지 않는다', () => {
    const r = resolveTier(input({ product: 'potato', productKo: '감자' }));
    assert.ok(!r.reason.includes('(으)'), r.reason);
    assert.ok(!r.reason.includes('감자은'), r.reason);
  });

  it('A/B 의 reason 은 재현율이 아니라 정밀도를 말한다', () => {
    const r = resolveTier(input({ product: 'apple', productKo: '사과' }));
    assert.match(r.reason, /사과로 본 49번 중 48번/);
  });
});

describe('tierHeadline — 화면 h1 과 TTS 가 같은 문장을 쓴다', () => {
  it('A 는 평서형, B 는 의문형, C 는 고백형', () => {
    assert.equal(tierHeadline('likely', '감자').title, '감자 같아요');
    assert.equal(tierHeadline('unsure', '사과').title, '혹시 사과인가요?');
    assert.equal(tierHeadline('unknown', '전복').title, '사진으로는 잘 모르겠어요');
  });
});

describe('photoStateLabel — 배지 주어는 사진이다', () => {
  it('"AI 품질 참고" 가 아니라 "사진 상태" 로 말한다', () => {
    assert.equal(photoStateLabel('상', []), '좋음');
    assert.equal(photoStateLabel('보통', []), '보통');
    assert.equal(photoStateLabel('확인필요', ['사진이 어두워 외관 확인이 어렵습니다.']), '어두움');
    assert.equal(photoStateLabel('확인필요', ['배경과 농산물이 잘 구분되지 않습니다.']), '확인 필요');
  });
});
