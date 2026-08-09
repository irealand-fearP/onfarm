import { db } from '../../db/index.js';
import { getListingView, listStoreListings } from '../../domain/listings.js';
import { createOrder, listOrdersForConsumer, OrderError } from '../../domain/orders.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { requireRole } from '../../lib/session.js';

interface OrderBody {
  lines?: Array<{ listingId?: number; quantity?: number }>;
  receiverName?: string;
  receiverPhone?: string;
  address?: string;
  memo?: string;
}

export function registerStoreRoutes(router: Router): void {
  router.get('/api/store/listings', (ctx) => {
    const filter: { productCode?: string; region?: string; limit?: number } = {};
    const product = ctx.query.get('product');
    const region = ctx.query.get('region');
    const limit = ctx.query.get('limit');
    if (product) filter.productCode = product;
    if (region) filter.region = region;
    // limit=abc 같은 값이 NaN 으로 SQL 에 들어가면 안 된다.
    if (limit && Number.isFinite(Number(limit))) filter.limit = Number(limit);
    ctx.json({ listings: listStoreListings(db(), filter) });
  });

  router.get('/api/store/listings/:id', (ctx) => {
    const id = Number(ctx.params['id']);
    const listing = Number.isInteger(id) ? getListingView(db(), id) : null;
    if (!listing) throw new HttpError(404, '상품을 찾을 수 없습니다.', 'not_found');
    ctx.json({ listing });
  });

  router.post('/api/store/orders', async (ctx) => {
    const user = requireRole(ctx.user, 'consumer');
    const body = await ctx.body<OrderBody>();

    // 클라이언트가 보낸 모양을 믿지 않는다. 배열이 아니면 400 이지 500 이 아니다.
    if (body.lines !== undefined && !Array.isArray(body.lines)) {
      throw new HttpError(400, '주문 항목 형식이 올바르지 않습니다.', 'bad_request');
    }
    const text = (value: unknown, fallback = ''): string =>
      typeof value === 'string' ? value : fallback;

    const lines = (body.lines ?? [])
      .filter((l): l is { listingId?: number; quantity?: number } => typeof l === 'object' && l !== null)
      .map((l) => ({ listingId: Number(l.listingId), quantity: Number(l.quantity) }))
      .filter((l) => Number.isInteger(l.listingId) && Number.isInteger(l.quantity));

    try {
      const created = createOrder(db(), {
        consumerId: user.id,
        lines,
        receiverName: text(body.receiverName, user.name).slice(0, 60),
        receiverPhone: text(body.receiverPhone, '010-0000-0000').slice(0, 30),
        address: text(body.address).slice(0, 200),
        ...(typeof body.memo === 'string' ? { memo: body.memo.slice(0, 200) } : {}),
      });
      ctx.json({ order: created.order, items: created.items }, 201);
    } catch (err) {
      if (err instanceof OrderError) {
        const status = err.code === 'OUT_OF_STOCK' ? 409 : err.code === 'NOT_FOUND' ? 404 : 400;
        throw new HttpError(status, err.message, err.code.toLowerCase());
      }
      throw err;
    }
  });

  router.get('/api/store/orders', (ctx) => {
    const user = requireRole(ctx.user, 'consumer');
    ctx.json({ orders: listOrdersForConsumer(db(), user.id) });
  });
}
