/**
 * Codex 교차검증(2026-08-09)이 지적한 결함들의 회귀 테스트.
 * 각 테스트는 고치기 전 코드에서 반드시 실패해야 한다.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateRecognition, hasForbiddenClaim } from '../ai/schema.js';
import type { CatalogItem } from '../ai/types.js';
import { hubCounters, recordInspection } from '../domain/inspections.js';
import { belongsToHub, listForHub } from '../domain/listings.js';
import { createOrder } from '../domain/orders.js';
import { orderNo } from '../lib/datetime.js';
import { parseDataUrl } from '../lib/images.js';
import { HttpError } from '../lib/http.js';
import { one } from '../db/index.js';
import { consumerNamed, freshDb } from './helpers.js';

const catalog: CatalogItem[] = [
  { code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배' },
  { code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사' },
];

const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('AI 스키마 강화', () => {
  it('숫자처럼 보이는 문자열 confidence 를 거부한다', () => {
    const res = validateRecognition(
      { product: 'pear', confidence: '0.99', quality_hint: '상', detected_issues: [], description_basis: [] },
      catalog,
    );
    assert.equal(res.ok, false, '"0.99" 는 숫자가 아니다 — 강제 변환하면 계약이 무의미해진다');
  });

  it('사진으로 알 수 없는 클레임(무농약·잔류농약·인증)을 근거 문장에서 제거한다', () => {
    const res = validateRecognition(
      {
        product: 'pear',
        confidence: 0.9,
        quality_hint: '상',
        detected_issues: [],
        description_basis: ['잔류농약 검사 완료', '외관이 비교적 균일함'],
      },
      catalog,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.description_basis, ['외관이 비교적 균일함']);
  });

  it('품종 추정에 인증·안전성 문구가 오면 카탈로그 품종으로 되돌린다', () => {
    const res = validateRecognition(
      { product: 'pear', confidence: 0.9, quality_hint: '상', variety_guess: '무농약 인증 배', detected_issues: [], description_basis: [] },
      catalog,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.variety_guess, '신고배');
  });

  it('금지 클레임 판별이 실제 문구를 잡는다', () => {
    for (const bad of ['무농약으로 키웠습니다', '잔류 농약 검사 완료', '당도 13브릭스', '국내 최초', 'HACCP 인증']) {
      assert.equal(hasForbiddenClaim(bad), true, `놓침: ${bad}`);
    }
    for (const ok of ['외관이 비교적 균일함', '큰 상처가 보이지 않음', '색이 고르게 나타납니다']) {
      assert.equal(hasForbiddenClaim(ok), false, `오탐: ${ok}`);
    }
  });

  it('배열 길이·문자열 길이 폭주를 막는다', () => {
    const res = validateRecognition(
      {
        product: 'pear',
        confidence: 0.9,
        quality_hint: '상',
        detected_issues: Array.from({ length: 50 }, (_, i) => `이슈${i}`),
        description_basis: [],
      },
      catalog,
    );
    assert.equal(res.ok, false);
  });
});

describe('업로드 검증', () => {
  it('선언 MIME 이 맞아도 실제 이미지가 아니면 거부한다', () => {
    // "Hello" 를 image/png 라고 선언한 경우
    assert.throws(
      () => parseDataUrl('data:image/png;base64,SGVsbG8='),
      (err: unknown) => err instanceof HttpError && err.status === 415,
    );
  });

  it('실제 PNG 는 통과하고 형식이 실제 바이트 기준으로 정해진다', () => {
    // jpeg 라고 잘못 선언해도 실제가 PNG 면 PNG 로 저장한다
    const parsed = parseDataUrl(`data:image/jpeg;base64,${PNG_1X1_B64}`);
    assert.equal(parsed.mimeType, 'image/png');
  });

  it('문자열이 아닌 값·깨진 base64 를 400/415 로 처리한다', () => {
    assert.throws(() => parseDataUrl({} as unknown), (e: unknown) => e instanceof HttpError);
    assert.throws(() => parseDataUrl('data:image/png;base64,!!!!'), (e: unknown) => e instanceof HttpError);
  });
});

describe('거점 권한 범위', () => {
  it('담당자는 자기 거점 물량만 본다', () => {
    const db = freshDb();
    const seonghwan = one<{ id: number; hub_id: number }>(
      db, "SELECT id, hub_id FROM users WHERE name = '성환거점 담당자'",
    );
    assert.ok(seonghwan?.hub_id);
    const scoped = listForHub(db, seonghwan.hub_id);
    const all = listForHub(db, null);
    assert.ok(scoped.length > 0);
    assert.ok(scoped.length < all.length, '전체보다 적어야 한다');
    assert.ok(scoped.every((l) => l.region_sigungu === '천안시'));
  });

  it('소관 판별이 다른 거점 매물을 거른다', () => {
    const db = freshDb();
    const jeju = listForHub(db, null).find((l) => l.region_sido === '제주');
    const seonghwanHub = one<{ id: number }>(db, "SELECT id FROM hubs WHERE name LIKE '천안%'");
    assert.ok(jeju && seonghwanHub);
    assert.equal(belongsToHub(db, jeju.id, seonghwanHub.id), false);
  });

  it('카운터도 거점 범위를 따른다', () => {
    const db = freshDb();
    const hub = one<{ id: number }>(db, "SELECT id FROM hubs WHERE name LIKE '천안%'");
    assert.ok(hub);
    const scoped = hubCounters(db, hub.id);
    const all = hubCounters(db, null);
    assert.ok(scoped.incoming < all.incoming);
  });
});

describe('주문번호', () => {
  it('충돌 공간이 4자리가 아니라 6자리다', () => {
    const no = orderNo(new Date('2026-08-09T00:00:00Z'), () => 0.5);
    assert.match(no, /^\d{8}-[0-9A-F]{6}$/);
  });

  it('같은 번호가 이미 있으면 다른 번호로 발급한다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const listing = listForHub(db, null)[0];
    assert.ok(listing);
    const first = createOrder(db, {
      consumerId: consumer.id,
      lines: [{ listingId: listing.id, quantity: 1 }],
      receiverName: '최수민', receiverPhone: '010', address: '천안',
    });
    const second = createOrder(db, {
      consumerId: consumer.id,
      lines: [{ listingId: listing.id, quantity: 1 }],
      receiverName: '최수민', receiverPhone: '010', address: '천안',
    });
    assert.notEqual(first.order.order_no, second.order.order_no);
  });
});

describe('검수 기록의 원자성', () => {
  it('반려는 판매 종료와 함께 기록된다', () => {
    const db = freshDb();
    const listing = listForHub(db, null)[0];
    assert.ok(listing);
    recordInspection(db, {
      listingId: listing.id, hubId: null, inspector: '담당자', result: 'reject', note: '부패',
    });
    const after = one<{ status: string; confirmed_quality: string | null }>(
      db, 'SELECT status, confirmed_quality FROM listings WHERE id = ?', listing.id,
    );
    assert.equal(after?.status, 'closed');
    assert.equal(after?.confirmed_quality, null, '반려는 확정 등급을 남기지 않는다');
  });
});
