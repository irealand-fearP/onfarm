import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { all, one } from '../db/index.js';
import { recordInspection, hubCounters } from '../domain/inspections.js';
import { getListingView, listStoreListings } from '../domain/listings.js';
import { createOrder, listOrdersForFarmer, OrderError } from '../domain/orders.js';
import { listSettlements, settlementSummary } from '../domain/settlements.js';
import type { ListingView } from '../domain/types.js';
import { consumerNamed, freshDb } from './helpers.js';

function firstTwoListings(db: ReturnType<typeof freshDb>): [ListingView, ListingView] {
  const rows = listStoreListings(db);
  assert.ok(rows.length >= 2, '시드 매물이 2개 이상이어야 한다');
  return [rows[0] as ListingView, rows[1] as ListingView];
}

describe('주문 생성', () => {
  it('주문하면 재고가 줄고 정산 예정이 생긴다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const [listing] = firstTwoListings(db);
    const before = listing.remaining_quantity;

    const { order, items } = createOrder(db, {
      consumerId: consumer.id,
      lines: [{ listingId: listing.id, quantity: 2 }],
      receiverName: '최수민',
      receiverPhone: '010-0000-0000',
      address: '충남 천안시 동남구',
    });

    assert.equal(order.total_amount, listing.unit_price * 2);
    assert.equal(items.length, 1);
    assert.equal(getListingView(db, listing.id)?.remaining_quantity, before - 2);

    const settlements = listSettlements(db, listing.farmer_id);
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0]?.gross, listing.unit_price * 2);
    assert.equal(settlements[0]?.net, settlements[0]!.gross - settlements[0]!.fee);
    assert.equal(settlements[0]?.status, 'pending');
  });

  it('주문이 들어오면 거점 검수 대기로 넘어간다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const [listing] = firstTwoListings(db);
    assert.equal(listing.inspection_status, 'ai_checked');

    createOrder(db, {
      consumerId: consumer.id,
      lines: [{ listingId: listing.id, quantity: 1 }],
      receiverName: '최수민',
      receiverPhone: '010-0000-0000',
      address: '충남 천안시',
    });

    assert.equal(getListingView(db, listing.id)?.inspection_status, 'hub_pending');
    assert.equal(hubCounters(db).needInspection, 1);
  });

  it('여러 상품을 한 주문에 담을 수 있다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const [a, b] = firstTwoListings(db);
    const { order, items } = createOrder(db, {
      consumerId: consumer.id,
      lines: [
        { listingId: a.id, quantity: 1 },
        { listingId: b.id, quantity: 2 },
      ],
      receiverName: '최수민',
      receiverPhone: '010-0000-0000',
      address: '서울시',
    });
    assert.equal(items.length, 2);
    assert.equal(order.total_amount, a.unit_price + b.unit_price * 2);
  });

  it('재고가 모자라면 전부 되돌린다 — 부분 성공은 없다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const [a, b] = firstTwoListings(db);
    const beforeA = a.remaining_quantity;

    assert.throws(
      () =>
        createOrder(db, {
          consumerId: consumer.id,
          lines: [
            { listingId: a.id, quantity: 1 },
            { listingId: b.id, quantity: b.remaining_quantity + 5 },
          ],
          receiverName: '최수민',
          receiverPhone: '010-0000-0000',
          address: '서울시',
        }),
      (err: unknown) => err instanceof OrderError && err.code === 'OUT_OF_STOCK',
    );

    assert.equal(getListingView(db, a.id)?.remaining_quantity, beforeA, 'A 재고가 되돌아와야 한다');
    assert.equal(all(db, 'SELECT id FROM orders').length, 0, '주문이 남으면 안 된다');
    assert.equal(all(db, 'SELECT id FROM order_items').length, 0);
    assert.equal(all(db, 'SELECT id FROM settlements').length, 0);
  });

  it('없는 상품·빈 주문·받는 분 누락을 막는다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const base = { consumerId: consumer.id, receiverName: '최수민', receiverPhone: '010', address: '서울' };
    assert.throws(() => createOrder(db, { ...base, lines: [] }), /주문할 상품/);
    assert.throws(() => createOrder(db, { ...base, lines: [{ listingId: 99999, quantity: 1 }] }), /찾을 수 없/);
    const [a] = firstTwoListings(db);
    assert.throws(
      () => createOrder(db, { ...base, address: '   ', lines: [{ listingId: a.id, quantity: 1 }] }),
      /받는 분/,
    );
  });

  it('농민 주문 목록과 정산 요약이 맞아떨어진다', () => {
    const db = freshDb();
    const consumer = consumerNamed(db);
    const [listing] = firstTwoListings(db);
    createOrder(db, {
      consumerId: consumer.id,
      lines: [{ listingId: listing.id, quantity: 3 }],
      receiverName: '최수민',
      receiverPhone: '010-0000-0000',
      address: '충남 천안시',
    });

    const orders = listOrdersForFarmer(db, listing.farmer_id);
    assert.equal(orders.length, 1);
    assert.equal(orders[0]?.quantity, 3);
    assert.equal(orders[0]?.title, listing.title);

    const summary = settlementSummary(db, listing.farmer_id);
    assert.equal(summary.count, 1);
    assert.equal(summary.totalGross, listing.unit_price * 3);
    assert.equal(summary.pendingNet, summary.totalGross - summary.totalFee);
  });
});

describe('거점 실물 검수', () => {
  it('검수를 통과시키면 상태가 넘어가고 기록이 남는다', () => {
    const db = freshDb();
    const [listing] = firstTwoListings(db);
    recordInspection(db, {
      listingId: listing.id,
      hubId: null,
      inspector: '성환거점 담당자',
      result: 'pass',
      gradedQuality: '상',
    });
    const after = getListingView(db, listing.id);
    assert.equal(after?.inspection_status, 'hub_passed');
    assert.equal(all(db, 'SELECT id FROM hub_inspections').length, 1);
  });

  it('등급 조정은 AI 참고값이 아니라 확정 등급을 덮어쓴다', () => {
    const db = freshDb();
    const [listing] = firstTwoListings(db);
    recordInspection(db, {
      listingId: listing.id,
      hubId: null,
      inspector: '담당자',
      result: 'downgrade',
      gradedQuality: '보통',
      note: '표면 흠집',
    });
    assert.equal(getListingView(db, listing.id)?.quality_hint, '보통');
    const row = one<{ result: string; graded_quality: string }>(
      db,
      'SELECT result, graded_quality FROM hub_inspections WHERE listing_id = ?',
      listing.id,
    );
    assert.equal(row?.result, 'downgrade');
  });

  it('반려하면 판매가 닫히고 매장에서 사라진다', () => {
    const db = freshDb();
    const [listing] = firstTwoListings(db);
    recordInspection(db, { listingId: listing.id, hubId: null, inspector: '담당자', result: 'reject', note: '부패' });
    assert.equal(getListingView(db, listing.id)?.status, 'closed');
    assert.equal(listStoreListings(db).find((l) => l.id === listing.id), undefined);
  });
});
