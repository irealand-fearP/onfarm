import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unknownRecognition, validateRecognition } from '../ai/schema.js';
import type { CatalogItem } from '../ai/types.js';

const catalog: CatalogItem[] = [
  { code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배' },
  { code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사' },
];

describe('AI 응답 스키마 검증', () => {
  it('정상 응답을 통과시키고 카탈로그 값으로 보정한다', () => {
    const res = validateRecognition(
      {
        category: 'fruit',
        product: 'pear',
        product_ko: '배',
        quality_hint: '상',
        confidence: 0.91,
        detected_issues: [],
        description_basis: ['외관이 비교적 균일함'],
      },
      catalog,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.product, 'pear');
    assert.equal(res.value.variety_guess, '신고배');
    assert.equal(res.value.confidence, 0.91);
  });

  it('카탈로그에 없는 품목은 거부한다 — 가격/SKU 가 없기 때문', () => {
    const res = validateRecognition(
      { product: 'durian', confidence: 0.99, quality_hint: '특', detected_issues: [], description_basis: [] },
      catalog,
    );
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.ok(res.errors.some((e) => e.includes('카탈로그에 없는 품목')));
  });

  it('confidence 가 숫자가 아니면 거부한다', () => {
    const res = validateRecognition({ product: 'pear', confidence: '아주 높음' }, catalog);
    assert.equal(res.ok, false);
  });

  it('허용되지 않은 quality_hint 를 거부한다', () => {
    const res = validateRecognition(
      { product: 'pear', confidence: 0.8, quality_hint: 'A+', detected_issues: [], description_basis: [] },
      catalog,
    );
    assert.equal(res.ok, false);
  });

  it('confidence 범위를 0~1 로 자른다', () => {
    const res = validateRecognition(
      { product: 'pear', confidence: 4.2, quality_hint: '상', detected_issues: [], description_basis: [] },
      catalog,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.confidence, 1);
  });

  it('객체가 아니면 거부한다', () => {
    assert.equal(validateRecognition('배입니다', catalog).ok, false);
    assert.equal(validateRecognition(null, catalog).ok, false);
    assert.equal(validateRecognition([1, 2], catalog).ok, false);
  });

  it('알 수 없는 결과는 신뢰도 0 · 확인필요 로 만든다', () => {
    const unknown = unknownRecognition('사진을 읽지 못함');
    assert.equal(unknown.confidence, 0);
    assert.equal(unknown.quality_hint, '확인필요');
    assert.equal(unknown.product, '');
  });

  it('alternatives 중 카탈로그에 없는 항목은 버린다', () => {
    const res = validateRecognition(
      {
        product: 'pear',
        confidence: 0.6,
        quality_hint: '상',
        detected_issues: [],
        description_basis: [],
        alternatives: [
          { product: 'apple', confidence: 0.3 },
          { product: 'durian', confidence: 0.2 },
        ],
      },
      catalog,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.alternatives?.length, 1);
    assert.equal(res.value.alternatives?.[0]?.product, 'apple');
  });
});
