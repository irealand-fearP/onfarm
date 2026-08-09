import { all, one, run } from '../db/index.js';
import type { Db } from '../db/index.js';
import { setInspectionStatus, setQualityHint } from './listings.js';
import type { HubInspection } from './types.js';

export interface InspectionInput {
  listingId: number;
  hubId: number | null;
  inspector: string;
  result: 'pass' | 'downgrade' | 'reject';
  gradedQuality?: string | null;
  note?: string | null;
}

/**
 * 거점 실물 검수 기록.
 * 여기서 확정된 등급만이 '확정 등급'이며, AI 참고 판정과 별도 컬럼으로 남는다.
 */
export function recordInspection(db: Db, input: InspectionInput): HubInspection {
  const res = run(
    db,
    `INSERT INTO hub_inspections (listing_id, hub_id, inspector, result, graded_quality, note)
     VALUES (?,?,?,?,?,?)`,
    input.listingId,
    input.hubId,
    input.inspector,
    input.result,
    input.gradedQuality ?? null,
    input.note ?? null,
  );

  if (input.result === 'reject') {
    run(db, "UPDATE listings SET status = 'closed' WHERE id = ?", input.listingId);
  } else {
    setInspectionStatus(db, input.listingId, 'hub_passed');
    if (input.gradedQuality) setQualityHint(db, input.listingId, input.gradedQuality);
  }

  const created = one<HubInspection>(
    db,
    'SELECT * FROM hub_inspections WHERE id = ?',
    res.lastInsertRowid,
  );
  if (!created) throw new Error('검수 기록 저장 실패');
  return created;
}

export function listInspections(db: Db, listingId: number): HubInspection[] {
  return all<HubInspection>(
    db,
    'SELECT * FROM hub_inspections WHERE listing_id = ? ORDER BY created_at DESC, id DESC',
    listingId,
  );
}

export interface HubCounters {
  incoming: number;
  needInspection: number;
  readyToShip: number;
  delivered: number;
  soldOut: number;
}

export function hubCounters(db: Db): HubCounters {
  const row = one<HubCounters>(
    db,
    `SELECT
       SUM(CASE WHEN inspection_status = 'ai_checked'     THEN 1 ELSE 0 END) AS incoming,
       SUM(CASE WHEN inspection_status = 'hub_pending'    THEN 1 ELSE 0 END) AS needInspection,
       SUM(CASE WHEN inspection_status IN ('hub_passed','ready_to_ship') THEN 1 ELSE 0 END) AS readyToShip,
       SUM(CASE WHEN inspection_status = 'delivered'      THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN status = 'sold_out'                  THEN 1 ELSE 0 END) AS soldOut
     FROM listings WHERE status != 'closed'`,
  );
  return {
    incoming: row?.incoming ?? 0,
    needInspection: row?.needInspection ?? 0,
    readyToShip: row?.readyToShip ?? 0,
    delivered: row?.delivered ?? 0,
    soldOut: row?.soldOut ?? 0,
  };
}
