/**
 * 다중 배율 판정이 **실행 중인 서버에서** 동작하는지 확인한다.
 *
 * 흉내 낸 값이 아니라, 로그인한 농가로 /api/ai/analyze 에 브라우저와 똑같은 형식
 * (사진 dataURL + 224×224 픽셀 base64 + 특징)을 보내 화면이 받는 후보를 그대로 본다.
 *
 *   python3 tools/dump_conditions.py --n 4 --out /tmp/onfarm-eval --conditions studio,far
 *   AI_PROVIDER=cnn PORT=4199 node dist/server/main.js &
 *   node tools/verify_server_tta.mjs --dir /tmp/onfarm-eval --base http://127.0.0.1:4199
 *
 * TTA 를 끄고 재려면 서버를 `ONFARM_CNN_TTA=off` 로 띄운다(같은 코드, 배율만 1개).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = process.cwd();
const DIR = argOf('--dir', '/tmp/onfarm-eval');
const BASE = argOf('--base', 'http://127.0.0.1:4173');
const ONLY = argOf('--cond', '');

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const { extractFeatures } = await import(pathToFileURL(join(ROOT, 'web/js/features.js')).href);

// 서버는 매물에 붙일 사진도 필요하다. 인코더를 새로 들이지 않게 이미 있는 jpeg-js 를 쓴다.
const { default: jpeg } = await import('jpeg-js');

function jpegDataUrl(rgb, size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = rgb[i * 3] ?? 0;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  const enc = jpeg.encode({ data: rgba, width: size, height: size }, 90);
  return `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`;
}

async function login() {
  const accounts = await (await fetch(`${BASE}/api/accounts`)).json();
  const list = accounts.accounts ?? accounts;
  const farmer = list.find((a) => a.role === 'farmer');
  if (!farmer) throw new Error('농가 계정을 찾지 못했습니다.');
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: farmer.id }),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

const cookie = await login();
const samples = manifest.samples.filter((s) => !ONLY || s.condition === ONLY);
const byCond = {};

for (const s of samples) {
  const rgba = new Uint8Array(readFileSync(join(DIR, s.feat)));
  const features = extractFeatures({ data: rgba }, s.width, s.height);
  const rgb = new Uint8Array(readFileSync(join(DIR, s.px)));

  const res = await fetch(`${BASE}/api/ai/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      image: jpegDataUrl(rgb, 224),
      pixels: Buffer.from(rgb).toString('base64'),
      features,
      demo: true,
    }),
  });
  if (!res.ok) throw new Error(`분석 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();

  // 화면이 보여주는 후보 그대로다.
  const candidates = body.candidates ?? body.result?.candidates ?? [];
  const codes = candidates.map((c) => c.code ?? c.product);
  const cell = (byCond[s.condition] ??= { label: s.label, n: 0, top1: 0, top3: 0, conf: 0 });
  cell.n += 1;
  if (codes[0] === s.code) cell.top1 += 1;
  if (codes.slice(0, 3).includes(s.code)) cell.top3 += 1;
  cell.conf += body.recognition?.confidence ?? body.result?.recognition?.confidence ?? 0;
}

const pct = (a, b) => `${Math.round((a / b) * 100)}%`;
console.log(`\n실행 중인 서버 응답 기준 (${BASE})`);
console.log(`TTA: ${process.env.ONFARM_CNN_TTA === 'off' ? '끔(서버 기동 환경변수)' : '켬(기본)'}\n`);
for (const [key, c] of Object.entries(byCond)) {
  console.log(
    `  ${c.label.padEnd(14)} n=${String(c.n).padStart(3)}  top-1 ${pct(c.top1, c.n).padStart(4)}` +
      `  top-3 ${pct(c.top3, c.n).padStart(4)}  평균 신뢰도 ${(c.conf / c.n).toFixed(2)}`,
  );
}
