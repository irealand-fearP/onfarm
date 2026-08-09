import { config } from '../../config.js';
import { resolveProvider } from '../../ai/providers/index.js';
import { catalog } from '../../ai/sku-matcher.js';
import { closeDb, db } from '../../db/index.js';
import { seed } from '../../db/seed.js';
import { existsSync, rmSync } from 'node:fs';
import { dbPath } from '../../config.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { clearAnalyses } from '../analysis-store.js';

export const BRAND = {
  name: 'ON-FARM',
  nameKo: '온팜',
  tagline: '사진 찍고, 수량 확인하면 끝.',
} as const;

export function registerSystemRoutes(router: Router): void {
  router.get('/api/config', (ctx) => {
    const provider = resolveProvider();
    ctx.json({
      brand: BRAND,
      ai: {
        provider: provider.primary.name,
        offline: provider.primary.offline,
        demoMode: provider.demoMode,
        degradedReason: provider.degradedReason,
        configured: config.ai.provider,
      },
      products: catalog(db()).map((p) => ({
        code: p.code,
        name: p.name_ko,
        emoji: p.emoji,
        category: p.category,
      })),
    });
  });

  /**
   * 시연 직전에 DB 를 초기 상태로 되돌린다.
   * 되돌리기 불가능한 동작이라 로컬(loopback) 요청에서만 허용한다.
   */
  router.post('/api/demo/reset', (ctx) => {
    const remote = ctx.req.socket.remoteAddress ?? '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLocal) {
      throw new HttpError(403, '데모 초기화는 로컬에서만 가능합니다.', 'forbidden');
    }
    clearAnalyses();
    closeDb();
    const path = dbPath();
    for (const suffix of ['', '-wal', '-shm']) {
      const f = `${path}${suffix}`;
      if (existsSync(f)) rmSync(f);
    }
    seed(db());
    ctx.json({ ok: true, message: '데모 데이터를 초기화했습니다.' });
  });
}
