import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.js';
import type { Role, User } from '../domain/types.js';
import { HttpError, parseCookies } from './http.js';

const COOKIE = 'onfarm_session';

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function issueSession(res: ServerResponse, userId: number): void {
  const value = String(userId);
  const cookie = `${value}.${sign(value)}`;
  res.setHeader(
    'set-cookie',
    `${COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export function clearSession(res: ServerResponse): void {
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** 쿠키에서 사용자 id 를 꺼낸다. 서명이 맞지 않으면 null. */
export function readSessionUserId(req: IncomingMessage): number | null {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(value);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function requireUser(user: User | null): User {
  if (!user) throw new HttpError(401, '로그인이 필요합니다.', 'unauthorized');
  return user;
}

/** 역할 기반 접근 제어. admin 은 모든 역할을 대신할 수 있다. */
export function requireRole(user: User | null, ...roles: Role[]): User {
  const u = requireUser(user);
  if (u.role === 'admin') return u;
  if (!roles.includes(u.role)) {
    throw new HttpError(403, '권한이 없습니다.', 'forbidden');
  }
  return u;
}
