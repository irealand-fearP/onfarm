import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, uploadsDir } from '../config.js';
import { db } from '../db/index.js';
import { seed } from '../db/seed.js';
import { getUser, listUsersByRole } from '../domain/users.js';
import { HttpError, readBody, Router, sendJson, serveFile } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { issueSession, readSessionUserId } from '../lib/session.js';
import { initProvider } from '../ai/providers/index.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerFarmerRoutes } from './routes/farmer.js';
import { registerHubRoutes } from './routes/hub.js';
import { registerStoreRoutes } from './routes/store.js';
import { registerSystemRoutes } from './routes/system.js';

/** 브라우저와 공유하는 컴파일 결과(dist/lib) 위치 */
function sharedModuleDir(): string {
  return dirname(fileURLToPath(new URL('../lib/korean.js', import.meta.url)));
}

/** 예쁜 URL → 실제 파일. 판매자·소비자·공용을 나눠 사이트 판정에 그대로 쓴다. */
const SELLER_PAGES: Record<string, string> = {
  '/seller': 'farmer/index.html',
  '/seller/sell': 'farmer/sell.html',
  '/seller/listings': 'farmer/listings.html',
  '/seller/orders': 'farmer/orders.html',
  '/seller/settlement': 'farmer/settlement.html',
};

const SHOP_PAGES: Record<string, string> = {
  '/': 'index.html',
  '/shop': 'index.html',
  '/shop/product': 'store/product.html',
  '/shop/cart': 'store/cart.html',
  '/shop/orders': 'store/orders.html',
};

/** 사이트 구분 없이 열리는 화면 */
const COMMON_PAGES: Record<string, string> = {
  '/login': 'login.html',
  '/demo': 'demo.html',
  '/hub': 'hub/index.html',
};

const PAGES: Record<string, string> = { ...SELLER_PAGES, ...SHOP_PAGES, ...COMMON_PAGES };

/** 옛 경로 → 새 경로 (하위 경로 포함) */
const LEGACY_PREFIXES: Record<string, string> = {
  '/farmer': '/seller',
  '/store': '/shop',
};

export type Site = 'seller' | 'shop';

/**
 * Host 헤더가 `seller.` 로 시작하면 판매자 사이트, 그 밖에는 소비자 사이트.
 * 경로가 `/seller` 로 시작하면 Host 와 무관하게 판매자 사이트다.
 * (도메인 없이도 시연해야 하므로 경로 분기를 항상 함께 지원한다.)
 */
export function resolveSite(host: string | undefined, pathname: string): Site {
  if (pathname === '/seller' || pathname.startsWith('/seller/')) return 'seller';
  const hostname = (host ?? '').split(':')[0]?.toLowerCase() ?? '';
  return hostname.startsWith('seller.') ? 'seller' : 'shop';
}

/**
 * 판매자 도메인(seller.*)으로 들어온 소비자 경로를 판매자 경로로 옮긴다.
 * 예) seller.example.com/ → /seller, seller.example.com/sell → /seller/sell
 */
export function sellerHostPath(pathname: string): string {
  if (pathname === '/seller' || pathname.startsWith('/seller/')) return pathname;
  if (pathname === '/') return '/seller';
  return `/seller${pathname}`;
}

/** 옛 경로면 새 경로를, 아니면 null 을 돌려준다. 확장자가 붙은 정적 파일은 건드리지 않는다. */
export function legacyRedirect(pathname: string): string | null {
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;
  for (const [from, to] of Object.entries(LEGACY_PREFIXES)) {
    if (pathname === from) return to;
    if (pathname.startsWith(`${from}/`)) return to + pathname.slice(from.length);
  }
  return null;
}

/**
 * 시연용 자동 로그인: 판매자 사이트에 세션 없이 들어오면 기본 농민 계정으로 세션을 발급한다.
 * 고령 사용자가 계정 목록이라는 벽을 만나지 않게 하기 위한 장치이며,
 * DEMO_AUTO_LOGIN=false 면 아무 일도 하지 않아 기존 로그인 흐름으로 돌아간다.
 */
function autoLoginDemoFarmer(ctx: Ctx): void {
  if (!config.demoAutoLogin) return;
  const farmer = listUsersByRole(db(), 'farmer')[0];
  if (!farmer) return;
  issueSession(ctx.res, farmer.id);
  ctx.user = farmer;
}

export function buildRouter(): Router {
  const router = new Router();
  registerSystemRoutes(router);
  registerAuthRoutes(router);
  registerAiRoutes(router);
  registerFarmerRoutes(router);
  registerStoreRoutes(router);
  registerHubRoutes(router);
  return router;
}

export function createApp(): Server {
  const router = buildRouter();

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    // '/%' 같은 잘못된 인코딩이 리스너 밖으로 던져지면 프로세스가 죽는다.
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, { error: '잘못된 주소입니다.', code: 'bad_url' }, 400);
      return;
    }

    const ctx: Ctx = {
      req,
      res,
      url,
      params: {},
      query: url.searchParams,
      user: null,
      body: <T>() => readBody<T>(req),
      json: (data, status = 200) => sendJson(res, data, status),
      text: (data, status = 200, type = 'text/plain; charset=utf-8') => {
        res.writeHead(status, { 'content-type': type });
        res.end(data);
      },
      redirect: (to) => {
        res.writeHead(302, { location: to });
        res.end();
      },
    };

    void (async () => {
      try {
        const uid = readSessionUserId(req);
        if (uid) ctx.user = getUser(db(), uid);

        // 1) API 라우트
        const matched = router.match(req.method ?? 'GET', pathname);
        if (matched) {
          ctx.params = matched.params;
          await matched.handler(ctx);
          return;
        }

        // 2) 업로드된 사진
        if (pathname.startsWith('/uploads/')) {
          if (serveFile(res, uploadsDir(), pathname.slice('/uploads/'.length))) return;
          throw new HttpError(404, '이미지를 찾을 수 없습니다.', 'not_found');
        }

        // 3) 서버·브라우저가 함께 쓰는 공용 모듈(수량 파서 등)을 그대로 내려준다.
        //    같은 코드를 두 번 구현하지 않기 위한 장치 — 테스트는 서버 쪽에서 돈다.
        if (req.method === 'GET' && pathname.startsWith('/js/shared/')) {
          const file = pathname.slice('/js/shared/'.length);
          if (serveFile(res, sharedModuleDir(), file)) return;
        }

        // 4) 페이지
        if (req.method === 'GET') {
          let pagePath = pathname.replace(/\/$/, '') || '/';

          // 4-1) 옛 주소(/farmer·/store)는 새 주소로 301 — 공유된 링크를 깨뜨리지 않는다.
          const moved = legacyRedirect(pagePath);
          if (moved) {
            res.writeHead(301, { location: moved + url.search });
            res.end();
            return;
          }

          // 4-2) 판매자 도메인(seller.*)으로 들어오면 같은 화면을 /seller 경로로 본다.
          const site = resolveSite(req.headers.host, pagePath);
          if (site === 'seller' && !(pagePath in SELLER_PAGES)) {
            const mapped = sellerHostPath(pagePath);
            if (mapped in SELLER_PAGES) pagePath = mapped;
          }

          const page = PAGES[pagePath];
          if (page) {
            // 4-3) 시연용 자동 로그인 — 판매자 사이트에서만, 세션이 없을 때만.
            if (site === 'seller' && pagePath in SELLER_PAGES && !ctx.user) {
              autoLoginDemoFarmer(ctx);
            }
            if (serveFile(res, config.publicDir, page)) return;
          }

          // 4) 정적 자산
          if (serveFile(res, config.publicDir, pathname)) return;
        }

        throw new HttpError(404, '페이지를 찾을 수 없습니다.', 'not_found');
      } catch (err) {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (err instanceof HttpError) {
          if (pathname.startsWith('/api/')) {
            sendJson(res, { error: err.message, code: err.code }, err.status);
          } else {
            res.writeHead(err.status, { 'content-type': 'text/html; charset=utf-8' });
            res.end(
              `<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem"><h1>${err.status}</h1><p>${err.message}</p><p><a href="/">처음으로</a></p></body>`,
            );
          }
          return;
        }
        console.error('[onfarm] 처리되지 않은 오류:', err);
        sendJson(res, { error: '서버 오류가 발생했습니다.', code: 'internal' }, 500);
      }
    })();
  });
}

export async function start(port = config.port, host = config.host): Promise<Server> {
  seed(db());
  await initProvider();
  const server = createApp();
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return server;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('server/main.js');
if (isMain) {
  const server = await start();
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.port;
  console.log('');
  console.log('  🌱  ON-FARM 서버가 실행 중입니다.');
  console.log(`  ▸ 소비자 매장   http://${config.host}:${actualPort}/shop`);
  console.log(`  ▸ 판매자 화면   http://${config.host}:${actualPort}/seller`);
  console.log(`  ▸ 거점/관리자   http://${config.host}:${actualPort}/hub`);
  console.log(`  ▸ 시연 시작     http://${config.host}:${actualPort}/demo`);
  console.log(`  ▸ AI provider   ${config.ai.provider}`);
  console.log('');
}
