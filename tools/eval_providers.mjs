/**
 * heuristic / CNN(TTA 끔) / CNN(TTA 켬) 세 경로를 **같은 사진**으로 재서 표로 낸다.
 *
 *   python3 tools/dump_conditions.py --n 8 --out /tmp/onfarm-eval
 *   npm run build && node tools/eval_providers.mjs --dir /tmp/onfarm-eval
 *
 * 판정은 흉내 내지 않고 서버가 쓰는 provider 코드(dist/)를 그대로 부른다.
 * 특징 추출도 브라우저 파일(web/js/features.js)을 그대로 import 한다 — 옮겨 적으면 어긋난다.
 *
 * ★ 표본의 한계를 먼저 읽을 것 ★
 *  · 상품 사진은 품목당 1장뿐이다. 변형 n 장은 독립 표본이 아니다.
 *  · heuristic 의 프로토타입 색표는 **바로 이 상품 사진들로 맞춘 값**이다(heuristic.ts 주석).
 *    즉 heuristic 에게 이 평가는 '자기가 공부한 시험지'다. 유리하게 나오는 것이 당연하다.
 *  · CNN 이 아는 품목은 5종(감귤·감자·배·사과·양파)뿐이고 우리 카탈로그는 16종이다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = process.cwd();
const DIR = argOf('--dir', '/tmp/onfarm-eval');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

const { extractFeatures } = await import(pathToFileURL(join(ROOT, 'web/js/features.js')).href);
const { HeuristicVisionProvider } = await import(
  pathToFileURL(join(ROOT, 'dist/ai/providers/heuristic.js')).href
);
const cnnModule = await import(pathToFileURL(join(ROOT, 'dist/ai/providers/cnn.js')).href);

/** seed.ts 와 같은 카탈로그(16종). 없는 품목을 후보로 만들지 않기 위해 provider 에 넘긴다. */
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

/** CNN provider 는 생성자가 private 이라 create() 로 만든다(모델·onnxruntime 필요). */
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

/**
 * TTA 를 끄고/켜고 각각 한 번씩 재려면 env 를 바꿔 가며 불러야 한다.
 * (cnn.ts activeScales 가 호출 시점의 process.env 를 본다)
 */
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
/** condition → route → { top1, top3, n, wrongConf: [] } */
const tally = {};
const perProduct = {};

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
    const names = [r.product, ...(r.alternatives ?? []).map((a) => a.product)];
    const hit1 = names[0] === s.code;
    const hit3 = names.slice(0, 3).includes(s.code);

    const bucket = (tally[s.condition] ??= {});
    const cell = (bucket[route] ??= { n: 0, top1: 0, top3: 0, conf: 0, wrongConf: [] });
    cell.n += 1;
    cell.top1 += hit1 ? 1 : 0;
    cell.top3 += hit3 ? 1 : 0;
    cell.conf += r.confidence;
    if (!hit1) cell.wrongConf.push(r.confidence);

    const pp = (perProduct[s.code] ??= {});
    const pc = (pp[route] ??= { n: 0, top1: 0, top3: 0 });
    pc.n += 1;
    pc.top1 += hit1 ? 1 : 0;
    pc.top3 += hit3 ? 1 : 0;
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '  -');
const pad = (s, w) => String(s).padEnd(w - [...String(s)].filter((c) => /[가-힣]/.test(c)).length);

console.log(`\n표본 ${manifest.samples.length}장 · 상품 16종 × 변형 ${manifest.n_per_product}장 × 조건 ${Object.keys(manifest.conditions).length}종`);
console.log('※ heuristic 색표는 이 상품 사진들로 맞춘 값이다 — heuristic 에게 유리한 시험지다.\n');

console.log('조건별 1순위 적중률 / 상위 3위 포함률');
console.log(`${pad('조건', 20)}${'heuristic'.padStart(12)}${'CNN(TTA끔)'.padStart(13)}${'CNN(TTA켬)'.padStart(13)}`);
console.log('-'.repeat(58));
for (const [cond, label] of Object.entries(manifest.conditions)) {
  const row = tally[cond];
  if (!row) continue;
  const cells = ROUTES.map((r) => `${pct(row[r].top1, row[r].n)}/${pct(row[r].top3, row[r].n)}`);
  console.log(`${pad(label, 20)}${cells[0].padStart(12)}${cells[1].padStart(13)}${cells[2].padStart(13)}`);
}

console.log('\n틀렸을 때의 평균 신뢰도 (낮을수록 안전 — 화면이 사용자를 덜 오도한다)');
console.log(`${pad('조건', 20)}${'heuristic'.padStart(12)}${'CNN(TTA끔)'.padStart(13)}${'CNN(TTA켬)'.padStart(13)}`);
console.log('-'.repeat(58));
for (const [cond, label] of Object.entries(manifest.conditions)) {
  const row = tally[cond];
  if (!row) continue;
  const cells = ROUTES.map((r) => {
    const w = row[r].wrongConf;
    return w.length ? `${(w.reduce((a, b) => a + b, 0) / w.length).toFixed(2)} (${w.length}건)` : '오답없음';
  });
  console.log(`${pad(label, 20)}${cells[0].padStart(12)}${cells[1].padStart(13)}${cells[2].padStart(13)}`);
}

console.log('\n상품별 1순위 적중률 (전 조건 합산)');
console.log(`${pad('상품', 14)}${'모델학습'.padStart(10)}${'heuristic'.padStart(12)}${'CNN(TTA끔)'.padStart(13)}${'CNN(TTA켬)'.padStart(13)}`);
console.log('-'.repeat(62));
const inModel = new Set(manifest.samples.filter((s) => s.in_model).map((s) => s.code));
for (const item of CATALOG) {
  const pp = perProduct[item.code];
  if (!pp) continue;
  const cells = ROUTES.map((r) => pct(pp[r].top1, pp[r].n));
  console.log(
    `${pad(item.name_ko, 14)}${(inModel.has(item.code) ? '○' : '×').padStart(8)}` +
      `${cells[0].padStart(12)}${cells[1].padStart(13)}${cells[2].padStart(13)}`,
  );
}

// 모델이 아는 5품목만 따로 — CNN 에게 가장 유리한 조건에서의 비교
const overall = (filter) => {
  const acc = Object.fromEntries(ROUTES.map((r) => [r, { n: 0, top1: 0, top3: 0 }]));
  for (const code of Object.keys(perProduct)) {
    if (!filter(code)) continue;
    for (const r of ROUTES) {
      acc[r].n += perProduct[code][r].n;
      acc[r].top1 += perProduct[code][r].top1;
      acc[r].top3 += perProduct[code][r].top3;
    }
  }
  return acc;
};

for (const [title, filter] of [
  ['전체 16종', () => true],
  ['모델이 아는 5종만', (c) => inModel.has(c)],
]) {
  const acc = overall(filter);
  console.log(`\n${title} — 1순위/상위3위`);
  for (const r of ROUTES) {
    console.log(`  ${r.padEnd(10)} ${pct(acc[r].top1, acc[r].n)} / ${pct(acc[r].top3, acc[r].n)}   (n=${acc[r].n})`);
  }
}
