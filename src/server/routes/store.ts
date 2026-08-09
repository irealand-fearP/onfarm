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
    if (limit) filter.limit = Number(limit);
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
    const lines = (body.lines ?? [])
      .map((l) => ({ listingId: Number(l.listingId), quantity: Number(l.quantity) }))
      .filter((l) => Number.isInteger(l.listingId) && Number.isInteger(l.quantity));

    try {
      const created = createOrder(db(), {
        consumerId: user.id,
        lines,
        receiverName: body.receiverName ?? user.name,
        receiverPhone: body.receiverPhone ?? '010-0000-0000',
        address: body.address ?? '',
        ...(body.memo ? { memo: body.memo } : {}),
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
