import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

/* 실제 데이터 폴더를 건드리지 않도록 임시 경로를 먼저 잡고 동적 import 한다. */
const workDir = mkdtempSync(join(tmpdir(), 'onfarm-test-'));
process.env['DATA_DIR'] = workDir;
process.env['DB_PATH'] = join(workDir, 'test.db');
process.env['AI_PROVIDER'] = 'mock'; // 무대 시연과 동일하게 고정 응답으로 검증
process.env['SESSION_SECRET'] = 'test-secret';

const { createApp } = await import('../server/main.js');
const { closeDb, db } = await import('../db/index.js');
const { seed } = await import('../db/seed.js');

seed(db());
const server = createApp();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FEATURES = {
  width: 256,
  height: 192,
  hueHistogram: [0.02, 0.7, 0.12, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.005, 0.005],
  meanSaturation: 0.35,
  meanValue: 0.62,
  edgeDensity: 0.3,
  hueConcentration: 0.72,
};

interface Reply {
  status: number;
  body: any;
}

function client() {
  let cookie = '';
  return async function call(path: string, options: { method?: string; body?: unknown } = {}): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (cookie) headers['cookie'] = cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
}

async function loginAs(call: ReturnType<typeof client>, name: string): Promise<number> {
  const accounts = await call('/api/accounts');
  const account = accounts.body.accounts.find((a: { name: string }) => a.name === name);
  assert.ok(account, `계정 없음: ${name}`);
  const res = await call('/api/auth/login', { body: { userId: account.id } });
  assert.equal(res.status, 200);
  return account.id;
}

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('HTTP — 설정과 권한', () => {
  it('설정 API 가 AI 상태를 그대로 노출한다', async () => {
    const call = client();
    const res = await call('/api/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.ai.provider, 'mock');
    assert.equal(res.body.ai.demoMode, true, '데모 모드는 화면에 배지로 표시돼야 한다');
    assert.ok(res.body.products.length >= 8);
  });

  it('로그인 없이 분석 API 를 부르면 401', async () => {
    const call = client();
    const res = await call('/api/ai/analyze', { body: { image: PNG_1X1 } });
    assert.equal(res.status, 401);
  });

  it('소비자는 판매 등록 흐름에 접근할 수 없다', async () => {
    const call = client();
    await loginAs(call, '장바구니');
    assert.equal((await call('/api/ai/analyze', { body: { image: PNG_1X1 } })).status, 403);
    assert.equal((await call('/api/farmer/listings')).status, 403);
    assert.equal((await call('/api/hub/dashboard')).status, 403);
  });

  it('농민은 거점 대시보드에 접근할 수 없다', async () => {
    const call = client();
    await loginAs(call, '김복순');
    assert.equal((await call('/api/hub/dashboard')).status, 403);
    assert.equal((await call('/api/store/orders')).status, 403);
  });

  it('거점 담당자는 대시보드를 볼 수 있다', async () => {
    const call = client();
    await loginAs(call, '성환거점 담당자');
    const res = await call('/api/hub/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.counters);
  });
});

describe('HTTP — 사진 한 장에서 주문까지', () => {
  it('전체 흐름이 실제로 돈다', async () => {
    const farmer = client();
    await loginAs(farmer, '김복순');

    // ① 사진 분석
    const analyzed = await farmer('/api/ai/analyze', { body: { image: PNG_1X1, features: FEATURES } });
    assert.equal(analyzed.status, 200);
    assert.ok(analyzed.body.analysisId);
    assert.equal(analyzed.body.recognition.product, 'pear');
    assert.equal(analyzed.body.decision.mode, 'auto');
    assert.equal(analyzed.body.selectedSku.price, 29000);
    assert.ok(analyzed.body.imagePath.startsWith('/uploads/'));
    const analysisId = analyzed.body.analysisId as string;

    // ② 품목과 맞지 않는 SKU 는 거부
    const appleSku = analyzed.body.catalog.find((c: { code: string }) => c.code === 'apple');
    assert.ok(appleSku);
    const mismatched = await farmer('/api/farmer/listings', {
      body: { analysisId, skuId: 3, quantity: 5 },
    });
    assert.equal(mismatched.status, 400);
    assert.equal(mismatched.body.code, 'sku_mismatch');

    // ③ 잘못된 수량 거부
    const badQty = await farmer('/api/farmer/listings', {
      body: { analysisId, skuId: analyzed.body.selectedSku.id, quantity: 0 },
    });
    assert.equal(badQty.status, 400);

    // ④ 정상 등록 — 가격은 클라이언트가 아니라 서버 SKU 에서 온다
    const created = await farmer('/api/farmer/listings', {
      body: { analysisId, skuId: analyzed.body.selectedSku.id, quantity: 5, unitPrice: 1 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.listing.unit_price, 29000);
    assert.equal(created.body.listing.remaining_quantity, 5);
    assert.match(created.body.listing.title, /수확한 신고배/);
    const listingId = created.body.listing.id as number;

    // ⑤ 소비자 매장 맨 위에 노출
    const store = client();
    const listed = await store('/api/store/listings');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.listings[0].id, listingId);
    assert.equal(listed.body.listings[0].farm_name, '복순이네 배농장');

    // ⑥ 소비자 주문
    await loginAs(store, '장바구니');
    const ordered = await store('/api/store/orders', {
      body: {
        lines: [{ listingId, quantity: 2 }],
        receiverName: '장바구니',
        receiverPhone: '010-5555-1000',
        address: '충남 천안시 동남구',
      },
    });
    assert.equal(ordered.status, 201);
    assert.equal(ordered.body.order.total_amount, 58000);

    // ⑦ 재고 초과 주문은 409
    const oversell = await store('/api/store/orders', {
      body: {
        lines: [{ listingId, quantity: 99 }],
        receiverName: '장바구니',
        receiverPhone: '010-5555-1000',
        address: '충남 천안시',
      },
    });
    assert.equal(oversell.status, 409);

    // ⑧ 농민 화면에 주문/정산이 보인다
    const orders = await farmer('/api/farmer/orders');
    assert.equal(orders.status, 200);
    assert.equal(orders.body.orders[0].quantity, 2);
    const settlements = await farmer('/api/farmer/settlements');
    assert.equal(settlements.body.summary.totalGross, 58000);

    // ⑨ 거점에서 검수하면 상태가 넘어간다
    const hub = client();
    await loginAs(hub, '성환거점 담당자');
    const inspected = await hub('/api/hub/inspections', {
      body: { listingId, result: 'pass', gradedQuality: '상' },
    });
    assert.equal(inspected.status, 201);
    const detail = await store(`/api/store/listings/${listingId}`);
    assert.equal(detail.body.listing.inspection_status, 'hub_passed');
    assert.equal(detail.body.listing.remaining_quantity, 3);
  });

  it('다른 농민의 분석 결과로는 상품을 올릴 수 없다', async () => {
    const a = client();
    await loginAs(a, '김복순');
    const analyzed = await a('/api/ai/analyze', { body: { image: PNG_1X1, features: FEATURES } });
    const analysisId = analyzed.body.analysisId as string;

    const b = client();
    await loginAs(b, '이만수');
    const stolen = await b('/api/farmer/listings', { body: { analysisId, quantity: 1 } });
    assert.equal(stolen.status, 410);
  });

  it('폴백 — 품목을 직접 고르면 그 품목으로 진행된다', async () => {
    const call = client();
    await loginAs(call, '김복순');
    const analyzed = await call('/api/ai/analyze', { body: { image: PNG_1X1, features: FEATURES } });
    const forced = await call('/api/ai/analyze', {
      body: { analysisId: analyzed.body.analysisId, productCode: 'sweet_potato' },
    });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.recognition.product, 'sweet_potato');
    assert.equal(forced.body.selectedSku.price, 15000);
    assert.equal(forced.body.ai.source, 'manual');
  });

  it('만료·위조된 분석 ID 는 거부한다', async () => {
    const call = client();
    await loginAs(call, '김복순');
    const res = await call('/api/farmer/listings', { body: { analysisId: 'not-a-real-id', quantity: 1 } });
    assert.equal(res.status, 410);
  });

  it('사진도 분석 ID 도 없으면 400', async () => {
    const call = client();
    await loginAs(call, '김복순');
    assert.equal((await call('/api/ai/analyze', { body: {} })).status, 400);
  });

  it('지원하지 않는 파일 형식은 415', async () => {
    const call = client();
    await loginAs(call, '김복순');
    const res = await call('/api/ai/analyze', { body: { image: 'data:application/pdf;base64,QQ==' } });
    assert.equal(res.status, 415);
  });

  it('농민은 자기 상품만 본다', async () => {
    const a = client();
    await loginAs(a, '김복순');
    const mine = await a('/api/farmer/listings');
    assert.ok(mine.body.listings.length > 0);
    assert.ok(mine.body.listings.every((l: { farm_name: string }) => l.farm_name === '복순이네 배농장'));
  });
});

describe('HTTP — 정적 화면', () => {
  it('주요 화면이 모두 응답한다', async () => {
    for (const path of [
      '/',
      '/login',
      '/demo',
      '/farmer',
      '/farmer/sell',
      '/farmer/listings',
      '/farmer/orders',
      '/farmer/settlement',
      '/store/product',
      '/store/cart',
      '/store/orders',
      '/hub',
      '/manifest.webmanifest',
      '/js/shared/korean.js',
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} 가 ${res.status}`);
    }
  });

  it('없는 경로는 404', async () => {
    assert.equal((await fetch(`${base}/없는페이지`)).status, 404);
  });

  it('상위 경로 탈출 시도를 막는다', async () => {
    const res = await fetch(`${base}/uploads/..%2F..%2Fpackage.json`);
    assert.ok(res.status === 404 || res.status === 400, `실제 ${res.status}`);
  });
});
