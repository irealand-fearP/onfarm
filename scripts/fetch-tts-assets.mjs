/**
 * Supertonic 3 음성 합성 자산을 Hugging Face 에서 받는다(약 380MB).
 *
 *   node scripts/fetch-tts-assets.mjs
 *
 * 왜 저장소에 안 넣고 받는가: 380MB 를 git 에 커밋하면 clone 이 무거워지고,
 * 모델 라이선스(OpenRAIL-M)가 코드 라이선스와 달라 섞어 두면 나중에 헷갈린다.
 * Dockerfile 이 이미지 빌드 때 부르므로 **런타임에는 네트워크가 필요 없다**.
 *
 * 실패해도 0 으로 끝난다 — 자산이 없으면 서버가 TTS 를 끄고 뜨고,
 * 화면은 브라우저 내장 음성으로 내려앉는다. 빌드를 죽일 이유가 없다.
 * (정말로 실패시키고 싶으면 --strict)
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.TTS_ASSETS_DIR ?? join(ROOT, 'vendor', 'supertonic', 'assets');
const REPO = process.env.TTS_HF_REPO ?? 'Supertone/supertonic-3';
const REVISION = process.env.TTS_HF_REVISION ?? 'main';
const BASE = `https://huggingface.co/${REPO}/resolve/${REVISION}`;
const strict = process.argv.includes('--strict');

/**
 * 받을 것만 딱 받는다. 화자는 F1 하나뿐이다 — 나머지 화자는 쓰지 않으므로 이미지에 넣지 않는다.
 * (F2·M1·M2 를 같이 받으면 이미지가 1MB 남짓 더 커질 뿐이지만, 안 쓰는 것을 싣지 않는다)
 */
const FILES = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  'voice_styles/F1.json',
];

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

async function fetchOne(rel) {
  const dest = join(OUT, rel);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  이미 있음 ${rel} (${mb(statSync(dest).size)})`);
    return statSync(dest).size;
  }
  mkdirSync(dirname(dest), { recursive: true });

  const res = await fetch(`${BASE}/${rel}?download=true`, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${rel} 내려받기 실패 ${res.status}`);

  // 받다 만 파일이 '있는 것'으로 보이면 안 된다 — 임시 이름으로 받고 다 받은 뒤 옮긴다.
  const tmp = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, dest);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw err;
  }
  const size = statSync(dest).size;
  console.log(`  받음     ${rel} (${mb(size)})`);
  return size;
}

console.log(`Supertonic 3 자산 내려받기 — ${REPO}@${REVISION} → ${OUT}`);
let total = 0;
try {
  for (const rel of FILES) total += await fetchOne(rel);
  console.log(`완료: ${FILES.length}개 파일, 합계 ${mb(total)}`);
} catch (err) {
  console.error(`⚠ 음성 합성 자산을 받지 못했습니다: ${err.message}`);
  console.error('  서버는 그대로 뜨고, 음성 안내는 브라우저 내장 음성으로 동작합니다.');
  if (strict) process.exit(1);
}
