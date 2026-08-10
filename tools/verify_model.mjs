/**
 * 학습된 모델을 ON-FARM 서버가 실제로 쓸 수 있는지, 그리고 보고된 정확도가
 * 재현되는지 확인한다.
 *
 * 왜 필요한가: Colab 이 보고한 품목 정확도 1.000 은 그대로 믿기 어려운 숫자다.
 * 같은 검증 이미지를 서버 쪽 경로(ONNX + 우리가 만든 전처리)로 다시 돌려서
 * ① 파이프라인이 연결됐는지 ② 숫자가 재현되는지 ③ 확신도 분포가 어떤지를 본다.
 *
 * 사용: node tools/verify_model.mjs [--n 400] [--data data/onfarm_cv] [--models models]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const DATA = arg('data', 'data/onfarm_cv');
const MODELS = arg('models', 'models');
const N = Number(arg('n', 400));

const meta = JSON.parse(readFileSync(join(MODELS, 'metadata.json'), 'utf8'));
const modelPath = join(MODELS, 'onfarm_qc.onnx');
if (!existsSync(modelPath)) throw new Error(`모델 없음: ${modelPath}`);

console.log(`품목 ${meta.items.join(', ')}`);
console.log(`보고된 개체 단위 정확도: 품목 ${meta.val_object_level.item} / 등급 ${meta.val_object_level.grade}\n`);

// ── 검증셋 표본 뽑기 (manifest 의 valid 행에서 균등하게) ─────────────────
const csv = readFileSync(join(DATA, 'manifest.csv'), 'utf8').split(/\r?\n/);
const header = csv[0].split(',');
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const valid = [];
for (let i = 1; i < csv.length; i += 1) {
  if (!csv[i]) continue;
  const c = csv[i].split(',');
  if (c[idx.split] !== 'valid') continue;
  valid.push({
    path: join(DATA, c[idx.path]),
    item: c[idx.item],
    grade: c[idx.grade],
    group: c[idx.group_no],
  });
}
console.log(`검증셋 ${valid.length.toLocaleString()}장 중 ${N}장을 균등 추출`);

const step = Math.max(1, Math.floor(valid.length / N));
const sample = valid.filter((_, i) => i % step === 0).slice(0, N);

// ── JPEG 디코딩: 서버엔 디코더가 없으므로 여기서만 sharp 없이 처리 ──────
// 학습 데이터는 이미 224x224 JPEG 라, 순수 JS 로 최소 디코딩만 한다.
let decodeJpeg;
try {
  decodeJpeg = require('jpeg-js').decode;
} catch {
  console.error('\njpeg-js 가 필요합니다(검증 전용, 서버 런타임과 무관):');
  console.error('  npm i -D jpeg-js');
  process.exit(2);
}

const ort = require('onnxruntime-node');
const session = await ort.InferenceSession.create(modelPath);
console.log(`ONNX 로딩 성공 — 입력 ${session.inputNames}, 출력 ${session.outputNames}\n`);

const { mean, std } = meta.normalize;
const SIZE = meta.img_size;

function toTensor(rgba, w, h) {
  if (w !== SIZE || h !== SIZE) throw new Error(`크기 불일치 ${w}x${h}`);
  const plane = SIZE * SIZE;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[c * plane + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
    }
  }
  return out;
}

function softmax(a) {
  const m = Math.max(...a);
  const e = a.map((v) => Math.exp(v - m));
  const s = e.reduce((x, y) => x + y, 0) || 1;
  return e.map((v) => v / s);
}

let itemOk = 0;
let gradeOk = 0;
const confRight = [];
const confWrong = [];
const perItem = {};
const byGroup = new Map();

for (const rec of sample) {
  const raw = readFileSync(rec.path);
  const img = decodeJpeg(raw, { useTArray: true });
  const tensor = new ort.Tensor('float32', toTensor(img.data, img.width, img.height), [1, 3, SIZE, SIZE]);
  const out = await session.run({ image: tensor });
  const itemProb = softmax(Array.from(out.item_logits.data));
  const gradeProb = softmax(Array.from(out.grade_logits.data));

  const pi = itemProb.indexOf(Math.max(...itemProb));
  const pg = gradeProb.indexOf(Math.max(...gradeProb));
  const predItem = meta.items[pi];
  const predGrade = meta.grades[pg];
  const conf = itemProb[pi];

  const right = predItem === rec.item;
  itemOk += right ? 1 : 0;
  gradeOk += predGrade === rec.grade ? 1 : 0;
  (right ? confRight : confWrong).push(conf);

  perItem[rec.item] ??= { n: 0, ok: 0, gradeOk: 0 };
  perItem[rec.item].n += 1;
  perItem[rec.item].ok += right ? 1 : 0;
  perItem[rec.item].gradeOk += predGrade === rec.grade ? 1 : 0;

  if (!byGroup.has(rec.group)) byGroup.set(rec.group, { true: rec.item, votes: {} });
  const g = byGroup.get(rec.group);
  g.votes[predItem] = (g.votes[predItem] ?? 0) + 1;
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
let groupOk = 0;
for (const g of byGroup.values()) {
  const top = Object.entries(g.votes).sort((a, b) => b[1] - a[1])[0][0];
  if (top === g.true) groupOk += 1;
}

console.log('='.repeat(58));
console.log(`이미지 단위  품목 ${(itemOk / sample.length).toFixed(3)} | 등급 ${(gradeOk / sample.length).toFixed(3)}  (n=${sample.length})`);
console.log(`개체 단위    품목 ${(groupOk / byGroup.size).toFixed(3)}  (개체 ${byGroup.size})`);
console.log('='.repeat(58));
for (const [name, s] of Object.entries(perItem).sort()) {
  console.log(`  ${name}: 품목 ${(s.ok / s.n).toFixed(3)} | 등급 ${(s.gradeOk / s.n).toFixed(3)} (n=${s.n})`);
}
console.log(`\n확신도  정답일 때 ${avg(confRight).toFixed(3)} / 오답일 때 ${confWrong.length ? avg(confWrong).toFixed(3) : '오답 없음'}`);
console.log(`오답 ${confWrong.length}건`);
