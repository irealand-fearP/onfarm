import { db } from '../../db/index.js';
import { hubCounters, listInspections, recordInspection } from '../../domain/inspections.js';
import { listForHub, setInspectionStatus } from '../../domain/listings.js';
import type { InspectionStatus } from '../../domain/types.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { requireRole } from '../../lib/session.js';

const ALLOWED_STATUS: InspectionStatus[] = ['ai_checked', 'hub_pending', 'hub_passed', 'ready_to_ship', 'delivered'];

export function registerHubRoutes(router: Router): void {
  router.get('/api/hub/dashboard', (ctx) => {
    requireRole(ctx.user, 'hub_operator');
    ctx.json({
      counters: hubCounters(db()),
      listings: listForHub(db()),
    });
  });

  router.get('/api/hub/listings/:id/inspections', (ctx) => {
    requireRole(ctx.user, 'hub_operator');
    const id = Number(ctx.params['id']);
    if (!Number.isInteger(id)) throw new HttpError(400, '잘못된 상품입니다.', 'bad_request');
    ctx.json({ inspections: listInspections(db(), id) });
  });

  /** 실물 검수 결과 입력 — 여기서 확정된 등급만 '확정'이다. */
  router.post('/api/hub/inspections', async (ctx) => {
    const user = requireRole(ctx.user, 'hub_operator');
    const body = await ctx.body<{
      listingId?: number;
      result?: string;
      gradedQuality?: string;
      note?: string;
      hubId?: number;
    }>();
    const listingId = Number(body.listingId);
    if (!Number.isInteger(listingId)) throw new HttpError(400, '상품을 선택해주세요.', 'bad_request');
    const result = body.result;
    if (result !== 'pass' && result !== 'downgrade' && result !== 'reject') {
      throw new HttpError(400, '검수 결과 값이 올바르지 않습니다.', 'bad_request');
    }
    const inspection = recordInspection(db(), {
      listingId,
      hubId: Number.isInteger(Number(body.hubId)) ? Number(body.hubId) : null,
      inspector: user.name,
      result,
      gradedQuality: body.gradedQuality ?? null,
      note: body.note ?? null,
    });
    ctx.json({ inspection }, 201);
  });

  router.post('/api/hub/listings/:id/status', async (ctx) => {
    requireRole(ctx.user, 'hub_operator');
    const id = Number(ctx.params['id']);
    const body = await ctx.body<{ status?: string }>();
    const status = body.status as InspectionStatus | undefined;
    if (!Number.isInteger(id) || !status || !ALLOWED_STATUS.includes(status)) {
      throw new HttpError(400, '상태 값이 올바르지 않습니다.', 'bad_request');
    }
    setInspectionStatus(db(), id, status);
    ctx.json({ ok: true, status });
  });
}
