import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { User } from '../domain/types.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  user: User | null;
  body: <T>() => Promise<T>;
  json: (data: unknown, status?: number) => void;
  text: (data: string, status?: number, type?: string) => void;
  redirect: (to: string) => void;
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const MAX_BODY_BYTES = 15 * 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({
      method,
      segments: path.split('/').filter(Boolean),
      handler,
    });
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler);
  }
  post(path: string, handler: Handler): void {
    this.add('POST', path, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i] ?? '';
        const part = parts[i] ?? '';
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(part);
        } else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

export async function readBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '요청이 너무 큽니다.', 'too_large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {} as T;
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다.', 'bad_json');
  }
  // `null`·배열·문자열도 유효한 JSON 이지만 본문 계약은 항상 객체다.
  // 여기서 걸러야 라우트의 body.foo 접근이 500 대신 400 을 낸다.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, '본문은 JSON 객체여야 합니다.', 'bad_json');
  }
  return parsed as T;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 디렉터리 밖으로 나가는 경로를 막고 파일을 스트리밍한다. */
export function serveFile(res: ServerResponse, rootDir: string, relPath: string): boolean {
  const clean = normalize(relPath).replace(/^([/\\])+/, '');
  if (clean.split(sep).includes('..')) return false;
  const full = join(rootDir, clean);
  if (!full.startsWith(rootDir)) return false;
  if (!existsSync(full)) return false;
  const stat = statSync(full);
  if (!stat.isFile()) return false;

  const ext = extname(full).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  // 코드·화면은 항상 재검증한다. 배포 직후 사용자가 옛 스크립트를 쓰는 사고를 막기 위함.
  // 이미지는 내용이 바뀌면 파일명이 바뀌므로 길게 캐시해도 안전하다.
  const codeLike = ['.html', '.js', '.mjs', '.css', '.webmanifest', '.json'].includes(ext);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': codeLike ? 'no-cache' : 'public, max-age=86400',
  });
  createReadStream(full).pipe(res);
  return true;
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}
