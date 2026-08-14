/**
 * 화면에 뜨는 신뢰도가 실제 적중률과 맞는지(보정, calibration) 재는 스크립트.
 *
 * 왜 필요한가: heuristic 은 최대 0.86 까지 표시하는데 실측 top-1 은 45% 다.
 * "모델이 0.8 이라고 말했을 때 실제로 몇 % 맞히는가" 를 알아야 보정 근거가 생긴다.
 *
 * 재현:
 *   python3 tools/dump_conditions.py --n 8 --out DIR --downscale {bilinear|nearest}
 *   npm run build && node tools/eval_calibration.mjs --dir DIR --label "A. 매끈한 축소"
 *
 * 판정은 흉내 내지 않고 서버가 쓰는 provider 코드(dist/)를 그대로 부른다.
 *
 * ★ 표본의 한계 ★
 *  · 상품 사진은 품목당 1장뿐. 변형 8장은 독립 표본이 아니다.
 *  · heuristic 색표는 바로 이 상품 사진들로 맞춘 값이다(heuristic.ts 주석) — 자기가 공부한 시험지.
 *  · 실제 폰으로 찍은 사진은 0장(field_evaluated: false). 전부 합성 변형이다.
 *  · CNN 이 아는 품목은 5종뿐, 카탈로그는 16종이다.
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
const LABEL = argOf('--label', DIR);
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

const { extractFeatures } = await import(pathToFileURL(join(ROOT, 'web/js/features.js')).href);
const { HeuristicVisionProvider } = await import(
  pathToFileURL(join(ROOT, 'dist/ai/providers/heuristic.js')).href
);
const cnnModule = await import(pathToFileURL(join(ROOT, 'dist/ai/providers/cnn.js')).href);

/** seed.ts 와 같은 카탈로그(16종). */
const CATALOG = [
  { code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배' },
  { code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사' },
  { code: 'sweet_potato', name_ko: '고구마', category: 'vegetable', variety: '호박고구마' },
  { code: 'potato', name_ko: '감자', category: 'vegetable', variety: '수미감자' },
  { code: 'onion', name_ko: '양파', category: 'vegetable', variety: '중만생종' },
  { code: 'mandarin', name_ko: '감귤', category: 'fruit', variety: '노지감귤' },
  { code: 'red_pepper', name_ko: '건고추', category: 'vegetable', variety: '태양초' },
  { code: 'peach', name_ko: '복숭아', category: 'fruit', variety: '황도' },
  { code: 'rice', name_ko: '쌀', category: 'grain', variety: '삼광' },
  { code: 'garlic', name_ko: '마늘', category: 'vegetable', variety: '남도마늘' },
  { code: 'grape', name_ko: '포도', category: 'fruit', variety: '샤인머스캣' },
  { code: 'persimmon', name_ko: '감', category: 'fruit', variety: '부유단감' },
  { code: 'mackerel', name_ko: '고등어', category: 'seafood', variety: '선망 고등어' },
  { code: 'shrimp', name_ko: '새우', category: 'seafood', variety: '흰다리새우' },
  { code: 'squid', name_ko: '오징어', category: 'seafood', variety: '살오징어' },
  { code: 'abalone', name_ko: '전복', category: 'seafood', variety: '활전복' },
];

async function makeCnn() {
  try {
    return await cnnModule.CnnVisionProvider.create(join(ROOT, 'models'));
  } catch (err) {
    console.error(`CNN 을 쓸 수 없습니다: ${err.message}`);
    return null;
  }
}

const heuristic = new HeuristicVisionProvider();
const cnn = await makeCnn();
if (!cnn) process.exit(2);

async function analyzeCnn(input, tta) {
  const before = process.env.ONFARM_CNN_TTA;
  process.env.ONFARM_CNN_TTA = tta ? 'on' : 'off';
  try {
    return await cnn.analyzeProduct(input);
  } finally {
    if (before === undefined) delete process.env.ONFARM_CNN_TTA;
    else process.env.ONFARM_CNN_TTA = before;
  }
}

const ROUTES = ['heuristic', 'cnn_off', 'cnn_tta'];
/** route → [{ confidence, hit1, code }] — 판정 한 건이 한 줄. */
const records = Object.fromEntries(ROUTES.map((r) => [r, []]));

for (const s of manifest.samples) {
  const rgba = new Uint8Array(readFileSync(join(DIR, s.feat)));
  const features = extractFeatures({ data: rgba }, s.width, s.height);
  const pixels = new Uint8Array(readFileSync(join(DIR, s.px)));
  const input = { features, pixels, catalog: CATALOG };

  const results = {
    heuristic: await heuristic.analyzeProduct(input),
    cnn_off: await analyzeCnn(input, false),
    cnn_tta: await analyzeCnn(input, true),
  };
  for (const route of ROUTES) {
    const r = results[route];
    records[route].push({ confidence: r.confidence, hit1: r.product === s.code, code: s.code });
  }
}

/** 신뢰도 구간 경계. 화면 상한 0.86 을 마지막 칸에 담기게 잡았다. */
const EDGES = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0001];

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '   -');
/** 한글 폭 보정 패딩. */
const pad = (s, w) => String(s).padEnd(w - [...String(s)].filter((c) => /[가-힣]/.test(c)).length);

function bucketize(rows) {
  const buckets = EDGES.slice(0, -1).map((lo, i) => ({
    lo,
    hi: EDGES[i + 1],
    n: 0,
    hit: 0,
    confSum: 0,
  }));
  for (const r of rows) {
    const i = buckets.findIndex((b) => r.confidence >= b.lo && r.confidence < b.hi);
    const b = buckets[i < 0 ? buckets.length - 1 : i];
    b.n += 1;
    b.hit += r.hit1 ? 1 : 0;
    b.confSum += r.confidence;
  }
  return buckets;
}

/** ECE: 구간별 |말한 신뢰도 평균 − 실제 적중률| 을 표본 수로 가중평균. */
function ece(buckets, total) {
  let sum = 0;
  for (const b of buckets) {
    if (!b.n) continue;
    sum += (b.n / total) * Math.abs(b.confSum / b.n - b.hit / b.n);
  }
  return sum;
}

console.log(`\n${'='.repeat(72)}\n${LABEL}  (표본 ${manifest.samples.length}장)\n${'='.repeat(72)}`);

for (const route of ROUTES) {
  const rows = records[route];
  const buckets = bucketize(rows);
  const total = rows.length;
  const acc = rows.filter((r) => r.hit1).length / total;
  console.log(`\n[${route}] 전체 top-1 ${pct(rows.filter((r) => r.hit1).length, total)}  ·  평균 신뢰도 ${(rows.reduce((a, b) => a + b.confidence, 0) / total).toFixed(3)}`);
  console.log(`${pad('모델이 말한 신뢰도', 22)}${'표본'.padStart(8)}${'평균신뢰도'.padStart(12)}${'실제 적중률'.padStart(14)}${'과대평가'.padStart(12)}`);
  console.log('-'.repeat(66));
  for (const b of buckets) {
    if (!b.n) continue;
    const said = b.confSum / b.n;
    const real = b.hit / b.n;
    const gap = said - real;
    console.log(
      `${pad(`${b.lo.toFixed(2)} ~ ${Math.min(b.hi, 1).toFixed(2)}`, 22)}` +
        `${String(b.n).padStart(8)}${said.toFixed(3).padStart(12)}` +
        `${pct(b.hit, b.n).padStart(14)}${(gap >= 0 ? '+' : '') + gap.toFixed(3).padStart(11)}`,
    );
  }
  console.log(`  관측 신뢰도 범위 ${Math.min(...rows.map((r) => r.confidence)).toFixed(3)} ~ ${Math.max(...rows.map((r) => r.confidence)).toFixed(3)} (코드 상한이 실제로 걸리는지 확인용)`);
  console.log(`  ECE(기대보정오차) ${ece(buckets, total).toFixed(3)}  ·  기저확률(무작정 1/16) 0.063  ·  전체정확도 ${acc.toFixed(3)}`);

  // 신뢰도가 정보를 갖는가 = 높은 신뢰도 절반과 낮은 절반의 적중률 차이
  const sorted = [...rows].sort((a, b) => a.confidence - b.confidence);
  const half = Math.floor(total / 2);
  const lowAcc = sorted.slice(0, half).filter((r) => r.hit1).length / half;
  const highAcc = sorted.slice(total - half).filter((r) => r.hit1).length / half;
  console.log(`  변별력: 하위50% 적중 ${(lowAcc * 100).toFixed(1)}%  vs  상위50% 적중 ${(highAcc * 100).toFixed(1)}%  (차이 ${((highAcc - lowAcc) * 100).toFixed(1)}p)`);
}

/*
  CNN 은 5품목만 배웠다. 높은 신뢰도에서 무너지는 게 '학습한 품목에서도 그런지' 아니면
  '학습하지 않은 11품목을 억지로 5개 중 하나로 부르느라 그런지' 를 갈라 봐야 원인이 다르다.
*/
const IN_MODEL = new Set(manifest.samples.filter((s) => s.in_model).map((s) => s.code));
for (const [title, filter] of [
  ['CNN 학습 5품목만', (c) => IN_MODEL.has(c)],
  ['CNN 미학습 11품목만', (c) => !IN_MODEL.has(c)],
]) {
  for (const route of ['cnn_off', 'cnn_tta']) {
    const rows = records[route].filter((r) => filter(r.code));
    if (!rows.length) continue;
    const buckets = bucketize(rows);
    const line = buckets
      .filter((b) => b.n)
      .map((b) => `${b.lo.toFixed(1)}~${Math.min(b.hi, 1).toFixed(1)}:${pct(b.hit, b.n)}(n=${b.n})`)
      .join('  ');
    console.log(`\n[${title} · ${route}] top-1 ${pct(rows.filter((r) => r.hit1).length, rows.length)}`);
    console.log(`  구간별 적중  ${line}`);
  }
}

console.log('\n품목별 top-1 적중률 / 평균 신뢰도');
console.log(`${pad('상품', 12)}${ROUTES.map((r) => r.padStart(22)).join('')}`);
console.log('-'.repeat(78));
for (const item of CATALOG) {
  const cells = ROUTES.map((route) => {
    const rows = records[route].filter((r) => r.code === item.code);
    if (!rows.length) return '-'.padStart(22);
    const a = pct(rows.filter((r) => r.hit1).length, rows.length);
    const c = (rows.reduce((s, r) => s + r.confidence, 0) / rows.length).toFixed(2);
    return `${a} (신뢰 ${c})`.padStart(22);
  });
  console.log(`${pad(item.name_ko, 12)}${cells.join('')}`);
}
