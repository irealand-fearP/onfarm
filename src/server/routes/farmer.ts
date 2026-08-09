import { findProductByCode, findSkuById } from '../../ai/sku-matcher.js';
import { db } from '../../db/index.js';
import { createListing, listByFarmer } from '../../domain/listings.js';
import { listOrdersForFarmer } from '../../domain/orders.js';
import { listSettlements, settlementSummary, DEMO_FEE_RATE } from '../../domain/settlements.js';
import { farmOf } from '../../domain/users.js';
import { todayKst } from '../../lib/datetime.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { requireRole } from '../../lib/session.js';
import { getAnalysis } from '../analysis-store.js';

interface CreateListingBody {
  analysisId?: string;
  skuId?: number;
  quantity?: number;
  harvestedOn?: string;
  /** 사용자가 폴백에서 품목을 바꿨을 때 */
  productCode?: string;
}

export function registerFarmerRoutes(router: Router): void {
  /**
   * STEP 7 — [판매 등록].
   * 가격/품목/문안은 클라이언트 값을 믿지 않고 서버가 다시 조립한다.
   * (클라이언트는 skuId 와 수량만 고른다)
   */
  router.post('/api/farmer/listings', async (ctx) => {
    const user = requireRole(ctx.user, 'farmer');
    const farm = farmOf(db(), user.id);
    if (!farm) throw new HttpError(400, '농가 정보가 없습니다.', 'no_farm');

    const body = await ctx.body<CreateListingBody>();
    if (!body.analysisId) throw new HttpError(400, '분석 정보가 없습니다.', 'bad_request');

    const analysis = getAnalysis(body.analysisId, user.id);
    if (!analysis) {
      throw new HttpError(410, '분석 결과가 만료되었습니다. 사진을 다시 찍어주세요.', 'expired');
    }

    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new HttpError(400, '수량은 1~999 사이여야 합니다.', 'bad_quantity');
    }

    const result = analysis.result;
    const productCode = body.productCode ?? result.recognition.product;
    const product = productCode ? findProductByCode(db(), productCode) : null;
    if (!product) throw new HttpError(400, '품목을 확인할 수 없습니다.', 'bad_product');

    const sku = body.skuId ? findSkuById(db(), Number(body.skuId)) : null;
    const chosenSku = sku ?? (result.selectedSku?.product_code === product.code ? result.selectedSku : null);
    if (!chosenSku) throw new HttpError(400, '판매 단위를 확인할 수 없습니다.', 'bad_sku');
    if (chosenSku.product_id !== product.id) {
      throw new HttpError(400, '품목과 판매 단위가 맞지 않습니다.', 'sku_mismatch');
    }

    // 문안은 분석 시점에 만들어 둔 것을 쓰되, 품목/SKU 가 바뀌었으면 다시 만든다.
    let title = result.draft?.title ?? '';
    let description = result.draft?.description ?? '';
    if (!title || result.selectedSku?.id !== chosenSku.id || result.recognition.product !== product.code) {
      const { writeProduct } = await import('../../ai/product-writer.js');
      const today = todayKst();
      const redraft = writeProduct({
        product,
        sku: chosenSku,
        farm,
        farmerName: user.name,
        recognition: { ...result.recognition, product: product.code, product_ko: product.name_ko },
        harvestedOn: body.harvestedOn ?? today,
        today,
        aiSourceLabel: result.ai.label,
      });
      title = redraft.title;
      description = redraft.description;
    }

    const listing = createListing(db(), {
      farmerId: user.id,
      farmId: farm.id,
      productId: product.id,
      skuId: chosenSku.id,
      title,
      description,
      imagePath: analysis.imagePath,
      quantity,
      unitPrice: chosenSku.price,
      harvestedOn: body.harvestedOn ?? todayKst(),
      aiAnalysis: {
        recognition: result.recognition,
        decision: result.decision,
        source: result.ai.source,
        offline: result.ai.offline,
        userOverride: body.productCode ? { productCode: body.productCode } : null,
      },
      aiConfidence: result.recognition.confidence,
      aiSource: body.productCode ? `${result.ai.source}+manual` : result.ai.source,
      qualityHint: result.recognition.quality_hint,
    });

    ctx.json({ listing }, 201);
  });

  router.get('/api/farmer/listings', (ctx) => {
    const user = requireRole(ctx.user, 'farmer');
    ctx.json({ listings: listByFarmer(db(), user.id) });
  });

  router.get('/api/farmer/orders', (ctx) => {
    const user = requireRole(ctx.user, 'farmer');
    ctx.json({ orders: listOrdersForFarmer(db(), user.id) });
  });

  router.get('/api/farmer/settlements', (ctx) => {
    const user = requireRole(ctx.user, 'farmer');
    ctx.json({
      summary: settlementSummary(db(), user.id),
      rows: listSettlements(db(), user.id),
      feeRate: DEMO_FEE_RATE,
    });
  });
}
