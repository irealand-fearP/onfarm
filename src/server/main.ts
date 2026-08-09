import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, uploadsDir } from '../config.js';
import { db } from '../db/index.js';
import { seed } from '../db/seed.js';
import { getUser } from '../domain/users.js';
import { HttpError, readBody, Router, sendJson, serveFile } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { readSessionUserId } from '../lib/session.js';
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

/** 예쁜 URL → 실제 파일 */
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/login': 'login.html',
  '/demo': 'demo.html',
  '/farmer': 'farmer/index.html',
  '/farmer/sell': 'farmer/sell.html',
  '/farmer/listings': 'farmer/listings.html',
  '/farmer/orders': 'farmer/orders.html',
  '/farmer/settlement': 'farmer/settlement.html',
  '/store': 'index.html',
  '/store/product': 'store/product.html',
  '/store/cart': 'store/cart.html',
  '/store/orders': 'store/orders.html',
  '/hub': 'hub/index.html',
};

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
    const pathname = decodeURIComponent(url.pathname);

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
          const page = PAGES[pathname.replace(/\/$/, '') || '/'];
          if (page && serveFile(res, config.publicDir, page)) return;

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
  console.log(`  ▸ 소비자 매장   http://${config.host}:${actualPort}/`);
  console.log(`  ▸ 농민 화면     http://${config.host}:${actualPort}/farmer`);
  console.log(`  ▸ 거점/관리자   http://${config.host}:${actualPort}/hub`);
  console.log(`  ▸ 시연 시작     http://${config.host}:${actualPort}/demo`);
  console.log(`  ▸ AI provider   ${config.ai.provider}`);
  console.log('');
}
