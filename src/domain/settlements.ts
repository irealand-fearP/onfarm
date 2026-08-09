import { all, one, run } from '../db/index.js';
import type { Db } from '../db/index.js';
import type { OrderItem, Settlement } from './types.js';

/**
 * 데모용 수수료율. 실제 요율은 운영 정책/계약으로 정해지며 코드가 정하지 않는다.
 * (기획서·화면에도 '가정값'으로 표기한다)
 */
export const DEMO_FEE_RATE = 0.08;

export function createSettlement(db: Db, item: OrderItem, feeRate = DEMO_FEE_RATE): Settlement {
  const gross = item.amount;
  const fee = Math.round(gross * feeRate);
  const net = gross - fee;
  const res = run(
    db,
    `INSERT INTO settlements (farmer_id, order_item_id, gross, fee, net, status)
     VALUES (?,?,?,?,?, 'pending')`,
    item.farmer_id,
    item.id,
    gross,
    fee,
    net,
  );
  const created = one<Settlement>(db, 'SELECT * FROM settlements WHERE id = ?', res.lastInsertRowid);
  if (!created) throw new Error('정산 레코드 생성 실패');
  return created;
}

export interface SettlementRow extends Settlement {
  order_no: string;
  title: string;
  quantity: number;
}

export function listSettlements(db: Db, farmerId: number): SettlementRow[] {
  return all<SettlementRow>(
    db,
    `SELECT st.*, o.order_no, l.title, oi.quantity
       FROM settlements st
       JOIN order_items oi ON oi.id = st.order_item_id
       JOIN orders o       ON o.id = oi.order_id
       JOIN listings l     ON l.id = oi.listing_id
      WHERE st.farmer_id = ?
      ORDER BY st.created_at DESC, st.id DESC`,
    farmerId,
  );
}

export interface SettlementSummary {
  pendingNet: number;
  paidNet: number;
  totalGross: number;
  totalFee: number;
  count: number;
}

export function settlementSummary(db: Db, farmerId: number): SettlementSummary {
  const row = one<{
    pendingNet: number | null;
    paidNet: number | null;
    totalGross: number | null;
    totalFee: number | null;
    count: number;
  }>(
    db,
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN net ELSE 0 END) AS pendingNet,
       SUM(CASE WHEN status = 'paid'    THEN net ELSE 0 END) AS paidNet,
       SUM(gross) AS totalGross,
       SUM(fee)   AS totalFee,
       COUNT(*)   AS count
     FROM settlements WHERE farmer_id = ?`,
    farmerId,
  );
  return {
    pendingNet: row?.pendingNet ?? 0,
    paidNet: row?.paidNet ?? 0,
    totalGross: row?.totalGross ?? 0,
    totalFee: row?.totalFee ?? 0,
    count: row?.count ?? 0,
  };
}
