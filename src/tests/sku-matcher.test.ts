import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalog, defaultSku, findProductByCode, matchSkus } from '../ai/sku-matcher.js';
import { run } from '../db/index.js';
import { freshDb } from './helpers.js';

describe('표준 SKU 매칭 — 가격의 유일한 출처', () => {
  it('품목 코드로 활성 SKU 를 기본값 먼저 돌려준다', () => {
    const db = freshDb(false);
    const skus = matchSkus(db, 'pear');
    assert.equal(skus.length, 2);
    assert.equal(skus[0]?.code, 'pear_shingo_5kg');
    assert.equal(skus[0]?.price, 29000);
    assert.equal(skus[1]?.price, 52000);
  });

  it('비활성 SKU 는 후보에서 빠진다', () => {
    const db = freshDb(false);
    run(db, "UPDATE skus SET active = 0 WHERE code = 'pear_shingo_5kg'");
    const skus = matchSkus(db, 'pear');
    assert.equal(skus.length, 1);
    assert.equal(skus[0]?.code, 'pear_shingo_10kg');
  });

  it('없는 품목이면 빈 배열 — 호출자가 폴백을 띄운다', () => {
    const db = freshDb(false);
    assert.deepEqual(matchSkus(db, 'durian'), []);
    assert.deepEqual(matchSkus(db, ''), []);
    assert.equal(defaultSku(db, 'durian'), null);
  });

  // 예전에는 '시드의 수산물이 비활성'이라는 사실에 기대 검증했지만, 수산물이 정식 오픈되며 그 전제가 깨졌다.
  // 검증하려던 것은 "비활성 품목은 카탈로그에서 빠진다"는 규칙 자체이므로, 시드 상태에 기대지 않고
  // 테스트 안에서 직접 품목 하나를 비활성으로 만들어 확인한다.
  it('비활성 품목은 카탈로그에 노출되지 않는다', () => {
    const db = freshDb(false);
    assert.ok(catalog(db).map((p) => p.code).includes('abalone'), '수산물도 이제 판매 품목이다');

    run(db, "UPDATE products SET active = 0 WHERE code = 'abalone'");
    const codes = catalog(db).map((p) => p.code);
    assert.ok(codes.includes('pear'));
    assert.ok(!codes.includes('abalone'), '비활성 품목은 카탈로그에서 빠져야 한다');
    assert.equal(findProductByCode(db, 'abalone'), null);
  });
});
