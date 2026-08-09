import { db } from '../../db/index.js';
import { hubCounters, listInspections, recordInspection } from '../../domain/inspections.js';
import { belongsToHub, getListingView, listForHub, setInspectionStatus } from '../../domain/listings.js';
import type { InspectionStatus, User } from '../../domain/types.js';
import { HttpError } from '../../lib/http.js';
import type { Ctx, Router } from '../../lib/http.js';
import { requireRole } from '../../lib/session.js';

/** 실물 검수로 확정할 수 있는 등급. 임의 문자열이 소비자 화면에 걸리면 안 된다. */
const GRADES = ['특', '상', '보통'] as const;

/**
 * 진행 상태는 되돌릴 수 없다.
 * 검수 전 매물을 곧바로 '배송 완료'로 만들거나 검수 완료를 다시 미검수로 되돌리는 것을 막는다.
 */
const NEXT_STATUS: Record<InspectionStatus, InspectionStatus[]> = {
  ai_checked: ['hub_pending'],
  hub_pending: [],           // 여기서 다음 단계로 가려면 검수 기록이 필요하다
  hub_passed: ['ready_to_ship'],
  ready_to_ship: ['delivered'],
  delivered: [],
};

/** 담당자는 자기 거점, 관리자는 전체. */
function hubScope(user: User): number | null {
  if (user.role === 'admin') return null;
  if (user.hub_id === null) {
    throw new HttpError(403, '소속 거점이 지정되지 않은 계정입니다.', 'no_hub');
  }
  return user.hub_id;
}

function assertInScope(ctx: Ctx, user: User, listingId: number): void {
  const scope = hubScope(user);
  if (scope === null) return; // 관리자
  if (!belongsToHub(db(), listingId, scope)) {
    throw new HttpError(403, '다른 거점의 상품입니다.', 'other_hub');
  }
}

export function registerHubRoutes(router: Router): void {
  router.get('/api/hub/dashboard', (ctx) => {
    const user = requireRole(ctx.user, 'hub_operator');
    const scope = hubScope(user);
    ctx.json({
      hubId: scope,
      counters: hubCounters(db(), scope),
      listings: listForHub(db(), scope),
      grades: GRADES,
    });
  });

  router.get('/api/hub/listings/:id/inspections', (ctx) => {
    const user = requireRole(ctx.user, 'hub_operator');
    const id = Number(ctx.params['id']);
    if (!Number.isInteger(id)) throw new HttpError(400, '잘못된 상품입니다.', 'bad_request');
    assertInScope(ctx, user, id);
    ctx.json({ inspections: listInspections(db(), id) });
  });

  /**
   * 실물 검수 결과 입력 — 여기서 확정된 등급만 '확정'이다.
   * AI 참고값을 그대로 승격시키지 않도록, 통과/조정 모두 담당자가 등급을 명시해야 한다.
   */
  router.post('/api/hub/inspections', async (ctx) => {
    const user = requireRole(ctx.user, 'hub_operator');
    const body = await ctx.body<{
      listingId?: number;
      result?: string;
      gradedQuality?: string;
      note?: string;
    }>();

    const listingId = Number(body.listingId);
    if (!Number.isInteger(listingId)) throw new HttpError(400, '상품을 선택해주세요.', 'bad_request');
    assertInScope(ctx, user, listingId);

    const listing = getListingView(db(), listingId);
    if (!listing) throw new HttpError(404, '상품을 찾을 수 없습니다.', 'not_found');
    if (listing.status === 'closed') {
      throw new HttpError(409, '이미 반려된 상품입니다.', 'closed');
    }

    const result = body.result;
    if (result !== 'pass' && result !== 'downgrade' && result !== 'reject') {
      throw new HttpError(400, '검수 결과 값이 올바르지 않습니다.', 'bad_request');
    }

    let gradedQuality: string | null = null;
    if (result !== 'reject') {
      const grade = typeof body.gradedQuality === 'string' ? body.gradedQuality.trim() : '';
      if (!(GRADES as readonly string[]).includes(grade)) {
        throw new HttpError(
          400,
          `확정 등급을 ${GRADES.join('/')} 중에서 선택해주세요.`,
          'bad_grade',
        );
      }
      gradedQuality = grade;
    }

    const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;

    const inspection = recordInspection(db(), {
      listingId,
      hubId: user.hub_id,
      inspector: user.name,
      result,
      gradedQuality,
      note,
    });
    ctx.json({ inspection }, 201);
  });

  router.post('/api/hub/listings/:id/status', async (ctx) => {
    const user = requireRole(ctx.user, 'hub_operator');
    const id = Number(ctx.params['id']);
    if (!Number.isInteger(id)) throw new HttpError(400, '잘못된 상품입니다.', 'bad_request');
    assertInScope(ctx, user, id);

    const body = await ctx.body<{ status?: string }>();
    const status = body.status as InspectionStatus | undefined;
    const listing = getListingView(db(), id);
    if (!listing) throw new HttpError(404, '상품을 찾을 수 없습니다.', 'not_found');
    if (!status || !NEXT_STATUS[listing.inspection_status]?.includes(status)) {
      throw new HttpError(
        409,
        `'${listing.inspection_status}' 다음 단계로 갈 수 없는 상태입니다.`,
        'bad_transition',
      );
    }
    setInspectionStatus(db(), id, status);
    ctx.json({ ok: true, status });
  });
}
