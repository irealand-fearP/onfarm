import { all, one, run, tx } from '../db/index.js';
import type { Db } from '../db/index.js';
import { orderNo } from '../lib/datetime.js';
import { decrementInventory } from './listings.js';
import { createSettlement } from './settlements.js';
import type { Listing, Order, OrderItem } from './types.js';

export interface OrderLine {
  listingId: number;
  quantity: number;
}

export interface CreateOrderInput {
  consumerId: number;
  lines: OrderLine[];
  receiverName: string;
  receiverPhone: string;
  address: string;
  memo?: string;
}

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code: 'EMPTY' | 'NOT_FOUND' | 'OUT_OF_STOCK' | 'INVALID',
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface CreatedOrder {
  order: Order;
  items: OrderItem[];
}

/**
 * 주문 생성. 재고 차감 → 주문/주문항목 → 정산 예정 레코드까지 한 트랜잭션으로 처리한다.
 * 재고가 모자라면 전체를 롤백한다(부분 성공 없음).
 */
export function createOrder(db: Db, input: CreateOrderInput): CreatedOrder {
  if (input.lines.length === 0) throw new OrderError('주문할 상품이 없습니다.', 'EMPTY');
  if (!input.receiverName.trim() || !input.receiverPhone.trim() || !input.address.trim()) {
    throw new OrderError('받는 분 정보가 필요합니다.', 'INVALID');
  }

  return tx(db, () => {
    let total = 0;
    const prepared: Array<{ listing: Listing; quantity: number; amount: number }> = [];

    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new OrderError('수량이 올바르지 않습니다.', 'INVALID');
      }
      const listing = one<Listing>(db, 'SELECT * FROM listings WHERE id = ?', line.listingId);
      if (!listing) throw new OrderError('상품을 찾을 수 없습니다.', 'NOT_FOUND');
      if (!decrementInventory(db, listing.id, line.quantity)) {
        throw new OrderError(`재고가 부족합니다: ${listing.title}`, 'OUT_OF_STOCK');
      }
      const amount = listing.unit_price * line.quantity;
      total += amount;
      prepared.push({ listing, quantity: line.quantity, amount });
    }

    const no = orderNo();
    const orderRes = run(
      db,
      `INSERT INTO orders (consumer_id, order_no, total_amount, receiver_name, receiver_phone, address, memo, status)
       VALUES (?,?,?,?,?,?,?, 'paid')`,
      input.consumerId,
      no,
      total,
      input.receiverName.trim(),
      input.receiverPhone.trim(),
      input.address.trim(),
      input.memo?.trim() ?? null,
    );
    const orderId = orderRes.lastInsertRowid;

    const items: OrderItem[] = [];
    for (const p of prepared) {
      const itemRes = run(
        db,
        `INSERT INTO order_items (order_id, listing_id, sku_id, farmer_id, unit_price, quantity, amount)
         VALUES (?,?,?,?,?,?,?)`,
        orderId,
        p.listing.id,
        p.listing.sku_id,
        p.listing.farmer_id,
        p.listing.unit_price,
        p.quantity,
        p.amount,
      );
      const item = one<OrderItem>(db, 'SELECT * FROM order_items WHERE id = ?', itemRes.lastInsertRowid);
      if (item) {
        items.push(item);
        createSettlement(db, item);
      }
      // 주문이 들어오면 거점 검수 대기로 넘어간다.
      run(
        db,
        `UPDATE listings SET inspection_status = 'hub_pending'
          WHERE id = ? AND inspection_status = 'ai_checked'`,
        p.listing.id,
      );
    }

    const order = one<Order>(db, 'SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw new OrderError('주문 생성에 실패했습니다.', 'INVALID');
    return { order, items };
  });
}

export interface FarmerOrderRow extends OrderItem {
  order_no: string;
  order_status: string;
  ordered_at: string;
  title: string;
  sku_label: string;
  receiver_name: string;
  address: string;
  inspection_status: string;
}

export function listOrdersForFarmer(db: Db, farmerId: number): FarmerOrderRow[] {
  return all<FarmerOrderRow>(
    db,
    `SELECT oi.*, o.order_no, o.status AS order_status, o.created_at AS ordered_at,
            o.receiver_name, o.address,
            l.title, l.inspection_status, s.label AS sku_label
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id
       JOIN listings l ON l.id = oi.listing_id
       JOIN skus s     ON s.id = oi.sku_id
      WHERE oi.farmer_id = ?
      ORDER BY o.created_at DESC, oi.id DESC`,
    farmerId,
  );
}

export interface ConsumerOrderRow {
  order_no: string;
  status: string;
  created_at: string;
  total_amount: number;
  items: Array<{ title: string; quantity: number; amount: number; inspection_status: string }>;
}

export function listOrdersForConsumer(db: Db, consumerId: number): ConsumerOrderRow[] {
  const orders = all<{
    id: number;
    order_no: string;
    status: string;
    created_at: string;
    total_amount: number;
  }>(
    db,
    'SELECT id, order_no, status, created_at, total_amount FROM orders WHERE consumer_id = ? ORDER BY created_at DESC, id DESC',
    consumerId,
  );
  return orders.map((o) => ({
    order_no: o.order_no,
    status: o.status,
    created_at: o.created_at,
    total_amount: o.total_amount,
    items: all<{ title: string; quantity: number; amount: number; inspection_status: string }>(
      db,
      `SELECT l.title, oi.quantity, oi.amount, l.inspection_status
         FROM order_items oi JOIN listings l ON l.id = oi.listing_id
        WHERE oi.order_id = ?`,
      o.id,
    ),
  }));
}

export function setOrderStatus(db: Db, orderId: number, status: Order['status']): void {
  run(db, 'UPDATE orders SET status = ? WHERE id = ?', status, orderId);
}
