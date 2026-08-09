import { db } from '../../db/index.js';
import { farmOf, getUser, listDemoAccounts } from '../../domain/users.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { clearSession, issueSession, requireUser } from '../../lib/session.js';

/**
 * MVP 인증은 '데모 계정 선택' 방식이다(비밀번호 없음).
 * 실제 도입 시 본인확인·간편인증으로 교체되는 자리이며, 세션·역할 검사 구조는 그대로 쓴다.
 */
export function registerAuthRoutes(router: Router): void {
  router.get('/api/accounts', (ctx) => {
    const rows = listDemoAccounts(db()).map((u) => {
      const farm = u.role === 'farmer' ? farmOf(db(), u.id) : null;
      return {
        id: u.id,
        role: u.role,
        name: u.name,
        farmName: farm?.farm_name ?? null,
        region: farm ? `${farm.region_sido} ${farm.region_sigungu}` : null,
      };
    });
    ctx.json({ accounts: rows });
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = await ctx.body<{ userId?: number }>();
    const id = Number(body.userId);
    if (!Number.isInteger(id)) throw new HttpError(400, '사용자를 선택해주세요.', 'bad_request');
    const user = getUser(db(), id);
    if (!user) throw new HttpError(404, '없는 계정입니다.', 'not_found');
    issueSession(ctx.res, user.id);
    ctx.json({ user });
  });

  router.post('/api/auth/logout', (ctx) => {
    clearSession(ctx.res);
    ctx.json({ ok: true });
  });

  router.get('/api/me', (ctx) => {
    const user = requireUser(ctx.user);
    const farm = user.role === 'farmer' ? farmOf(db(), user.id) : null;
    ctx.json({ user, farm });
  });
}
