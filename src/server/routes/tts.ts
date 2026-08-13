import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { MAX_TEXT_LENGTH, checkText, speak, ttsStatus } from '../tts.js';

/**
 * 음성 안내를 서버에서 합성해 내려준다.
 *
 * 공개 주소에 붙는 엔드포인트라 세 겹으로 막는다.
 *  ① 글자 수·허용 문자 검사(tts.ts checkText) — 화면 문구에 쓰는 글자만 통과한다.
 *  ② 캐시 — 같은 문장은 두 번째부터 합성하지 않는다.
 *  ③ 요청 제한 — 캐시에 없는 문장(=실제 합성)만 세서 IP 당 분당 상한을 건다.
 *     캐시 적중은 파일 읽기라 싸므로 넉넉히 두고, 합성만 조인다.
 */

const WINDOW_MS = 60_000;
/** IP 당 1분에 새로 합성해 줄 문장 수. 시연 한 바퀴가 20문장 남짓이라 그보다 넉넉하다. */
const SYNTH_PER_MIN = 30;
/** IP 당 1분 총 요청 수(캐시 적중 포함). */
const REQ_PER_MIN = 240;

interface Bucket {
  windowStart: number;
  requests: number;
  synths: number;
}

const buckets = new Map<string, Bucket>();

function clientKey(ctx: { req: { socket: { remoteAddress?: string | undefined }; headers: Record<string, unknown> } }): string {
  // 프록시 뒤에서는 소켓 주소가 전부 같다. 앞단이 붙여 주는 값을 우선 본다.
  const forwarded = ctx.req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.trim()) return first.split(',')[0]!.trim();
  return ctx.req.socket.remoteAddress ?? 'unknown';
}

function takeBucket(key: string): Bucket {
  const now = Date.now();
  const found = buckets.get(key);
  if (!found || now - found.windowStart >= WINDOW_MS) {
    const fresh = { windowStart: now, requests: 0, synths: 0 };
    buckets.set(key, fresh);
    // 오래된 항목이 쌓이지 않게 가끔 치운다(시연 규모라 이 정도로 충분하다).
    if (buckets.size > 500) {
      for (const [k, v] of buckets) if (now - v.windowStart >= WINDOW_MS) buckets.delete(k);
    }
    return fresh;
  }
  return found;
}

/** 테스트에서 창을 초기화하려고 쓴다. */
export function resetTtsLimits(): void {
  buckets.clear();
}

export function registerTtsRoutes(router: Router): void {
  /** 화면이 서버 음성을 쓸 수 있는지 먼저 물어본다. */
  router.get('/api/tts/status', (ctx) => {
    ctx.json(ttsStatus());
  });

  router.get('/api/tts', async (ctx) => {
    const bucket = takeBucket(clientKey(ctx as never));
    bucket.requests += 1;
    if (bucket.requests > REQ_PER_MIN) {
      throw new HttpError(429, '요청이 너무 잦습니다.', 'rate_limited');
    }

    const checked = checkText(ctx.query.get('text'));
    if (!checked.ok) throw new HttpError(400, checked.reason, 'bad_text');

    // 합성이 필요한지는 speak() 안에서만 알 수 있으므로, 상한에 걸린 상태면 미리 막는다.
    if (bucket.synths >= SYNTH_PER_MIN) {
      throw new HttpError(429, '요청이 너무 잦습니다.', 'rate_limited');
    }

    const result = await speak(checked.text);
    if (!result) {
      // 자산이 없거나 엔진을 못 올린 상태 — 화면은 이 응답을 보고 내장 음성으로 내려앉는다.
      throw new HttpError(503, '서버 음성 합성을 쓸 수 없습니다.', 'tts_unavailable');
    }
    if (!result.cached) bucket.synths += 1;

    ctx.res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': result.wav.length,
      // 문장이 키라 내용이 바뀌지 않는다. 브라우저가 다시 받지 않게 길게 준다.
      // (HTML 은 여전히 no-store 다 — serveFile 의 규칙을 건드리지 않는다)
      'cache-control': 'public, max-age=86400',
      'x-tts-cache': result.cached ? 'hit' : 'miss',
    });
    ctx.res.end(result.wav);
  });
}

export { MAX_TEXT_LENGTH };
