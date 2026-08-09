import { writeProduct } from '../ai/product-writer.js';
import type { SkuCandidate } from '../ai/sku-matcher.js';
import { createListing } from '../domain/listings.js';
import type { Farm, Product } from '../domain/types.js';
import { todayKst } from '../lib/datetime.js';
import { all, one, run } from './index.js';
import type { Db } from './index.js';

interface SeedProduct {
  code: string;
  name_ko: string;
  category: string;
  variety: string | null;
  emoji: string;
  sample: string;
  active?: number;
  skus: Array<{ code: string; label: string; weight: number; unit: string; price: number; isDefault?: boolean }>;
}

/**
 * 표준 품목/SKU 마스터.
 * 가격은 '운영자가 등록하는 정찰가' 자리다 — 실제 도입 시 지자체·직매장과 합의한 값으로 대체한다.
 * (여기 값은 시연용 가정값이며 시세를 주장하지 않는다)
 */
export const SEED_PRODUCTS: SeedProduct[] = [
  {
    code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배', emoji: '🍐',
    sample: '/img/sample/pear.svg',
    skus: [
      { code: 'pear_shingo_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 29000, isDefault: true },
      { code: 'pear_shingo_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 52000 },
    ],
  },
  {
    code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사', emoji: '🍎',
    sample: '/img/sample/apple.svg',
    skus: [
      { code: 'apple_fuji_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 32000, isDefault: true },
      { code: 'apple_fuji_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 58000 },
    ],
  },
  {
    code: 'sweet_potato', name_ko: '고구마', category: 'root', variety: '호박고구마', emoji: '🍠',
    sample: '/img/sample/sweet_potato.svg',
    skus: [
      { code: 'sweet_potato_3kg', label: '3kg 한 상자', weight: 3, unit: 'kg', price: 15000, isDefault: true },
      { code: 'sweet_potato_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 23000 },
    ],
  },
  {
    code: 'potato', name_ko: '감자', category: 'root', variety: '수미감자', emoji: '🥔',
    sample: '/img/sample/potato.svg',
    skus: [
      { code: 'potato_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 14000, isDefault: true },
      { code: 'potato_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 25000 },
    ],
  },
  {
    code: 'onion', name_ko: '양파', category: 'vegetable', variety: '중만생종', emoji: '🧅',
    sample: '/img/sample/onion.svg',
    skus: [
      { code: 'onion_3kg', label: '3kg 한 망', weight: 3, unit: 'kg', price: 9000, isDefault: true },
      { code: 'onion_10kg', label: '10kg 한 망', weight: 10, unit: 'kg', price: 22000 },
    ],
  },
  {
    code: 'mandarin', name_ko: '감귤', category: 'fruit', variety: '노지감귤', emoji: '🍊',
    sample: '/img/sample/mandarin.svg',
    skus: [
      { code: 'mandarin_3kg', label: '3kg 한 상자', weight: 3, unit: 'kg', price: 18000, isDefault: true },
      { code: 'mandarin_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 27000 },
    ],
  },
  {
    code: 'red_pepper', name_ko: '건고추', category: 'vegetable', variety: '태양초', emoji: '🌶️',
    sample: '/img/sample/red_pepper.svg',
    skus: [
      { code: 'red_pepper_600g', label: '600g 한 봉', weight: 0.6, unit: 'kg', price: 20000, isDefault: true },
      { code: 'red_pepper_1kg', label: '1kg 한 봉', weight: 1, unit: 'kg', price: 32000 },
    ],
  },
  {
    code: 'peach', name_ko: '복숭아', category: 'fruit', variety: '황도', emoji: '🍑',
    sample: '/img/sample/peach.svg',
    skus: [
      { code: 'peach_4kg', label: '4kg 한 상자', weight: 4, unit: 'kg', price: 32000, isDefault: true },
      { code: 'peach_2kg', label: '2kg 한 상자', weight: 2, unit: 'kg', price: 19000 },
    ],
  },
  {
    // Phase 2 (수산물). 스키마·SKU 자리는 만들어 두되 MVP 에서는 비활성.
    code: 'abalone', name_ko: '전복', category: 'seafood', variety: null, emoji: '🐚',
    sample: '/img/sample/abalone.svg', active: 0,
    skus: [{ code: 'abalone_1kg', label: '1kg (10미)', weight: 1, unit: 'kg', price: 45000, isDefault: true }],
  },
];

const SEED_HUBS = [
  { name: '천안 성환 로컬푸드 거점', region: '충남 천안시', address: '충남 천안시 서북구 성환읍' },
  { name: '충주 로컬푸드 거점', region: '충북 충주시', address: '충북 충주시' },
  { name: '제주 서귀포 거점', region: '제주 서귀포시', address: '제주 서귀포시' },
];

interface SeedFarmer {
  name: string;
  phone: string;
  farm: string;
  sido: string;
  sigungu: string;
  detail: string;
  hubIndex: number;
}

const SEED_FARMERS: SeedFarmer[] = [
  { name: '김복순', phone: '010-1234-0001', farm: '복순이네 배농장', sido: '충남', sigungu: '천안시', detail: '성환읍', hubIndex: 0 },
  { name: '이만수', phone: '010-1234-0002', farm: '만수농원', sido: '충북', sigungu: '충주시', detail: '앙성면', hubIndex: 1 },
  { name: '박정자', phone: '010-1234-0003', farm: '정자네 텃밭', sido: '충북', sigungu: '괴산군', detail: '칠성면', hubIndex: 1 },
  { name: '고영희', phone: '010-1234-0004', farm: '한라감귤원', sido: '제주', sigungu: '서귀포시', detail: '남원읍', hubIndex: 2 },
];

/** 시연용 초기 매물: [농부 index, 품목 code, 수량, 며칠 전 수확] */
const SEED_LISTINGS: Array<[number, string, number, number]> = [
  [0, 'pear', 8, 0],
  [1, 'apple', 6, 0],
  [2, 'red_pepper', 12, 1],
  [3, 'mandarin', 10, 0],
  [2, 'sweet_potato', 5, 1],
];

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayKst(d);
}

export interface SeedOptions {
  withListings?: boolean;
}

export function seed(db: Db, options: SeedOptions = {}): void {
  const withListings = options.withListings ?? true;

  for (const hub of SEED_HUBS) {
    if (!one(db, 'SELECT id FROM hubs WHERE name = ?', hub.name)) {
      run(db, 'INSERT INTO hubs (name, region, address) VALUES (?,?,?)', hub.name, hub.region, hub.address);
    }
  }
  const hubs = all<{ id: number; name: string }>(db, 'SELECT id, name FROM hubs ORDER BY id');

  for (const p of SEED_PRODUCTS) {
    let product = one<Product>(db, 'SELECT * FROM products WHERE code = ?', p.code);
    if (!product) {
      run(
        db,
        'INSERT INTO products (code, name_ko, category, variety, emoji, sample_image, active) VALUES (?,?,?,?,?,?,?)',
        p.code, p.name_ko, p.category, p.variety, p.emoji, p.sample, p.active ?? 1,
      );
      product = one<Product>(db, 'SELECT * FROM products WHERE code = ?', p.code);
    }
    if (!product) continue;
    for (const s of p.skus) {
      if (!one(db, 'SELECT id FROM skus WHERE code = ?', s.code)) {
        run(
          db,
          'INSERT INTO skus (product_id, code, label, weight, unit, price, is_default, active) VALUES (?,?,?,?,?,?,?,1)',
          product.id, s.code, s.label, s.weight, s.unit, s.price, s.isDefault ? 1 : 0,
        );
      }
    }
  }

  for (const f of SEED_FARMERS) {
    let user = one<{ id: number }>(db, 'SELECT id FROM users WHERE name = ? AND role = ?', f.name, 'farmer');
    if (!user) {
      const res = run(db, 'INSERT INTO users (role, name, phone) VALUES (?,?,?)', 'farmer', f.name, f.phone);
      user = { id: res.lastInsertRowid };
      const hubId = hubs[f.hubIndex]?.id ?? null;
      run(
        db,
        'INSERT INTO farms (user_id, farm_name, region_sido, region_sigungu, region_detail, hub_id) VALUES (?,?,?,?,?,?)',
        user.id, f.farm, f.sido, f.sigungu, f.detail, hubId,
      );
    }
  }

  const others: Array<[string, string, string]> = [
    ['consumer', '장바구니', '010-5555-1000'],
    ['consumer', '최수민', '010-5555-1001'],
    ['hub_operator', '성환거점 담당자', '010-7777-2000'],
    ['admin', '운영자', '010-9999-3000'],
  ];
  for (const [role, name, phone] of others) {
    if (!one(db, 'SELECT id FROM users WHERE name = ? AND role = ?', name, role)) {
      run(db, 'INSERT INTO users (role, name, phone) VALUES (?,?,?)', role, name, phone);
    }
  }

  if (!withListings) return;
  const existing = one<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM listings');
  if ((existing?.c ?? 0) > 0) return;

  const today = todayKst();
  for (const [farmerIdx, productCode, quantity, ago] of SEED_LISTINGS) {
    const seedFarmer = SEED_FARMERS[farmerIdx];
    if (!seedFarmer) continue;
    const user = one<{ id: number; name: string }>(
      db, 'SELECT id, name FROM users WHERE name = ? AND role = ?', seedFarmer.name, 'farmer',
    );
    const farm = user ? one<Farm>(db, 'SELECT * FROM farms WHERE user_id = ?', user.id) : null;
    const product = one<Product>(db, 'SELECT * FROM products WHERE code = ?', productCode);
    const sku = product
      ? one<SkuCandidate>(
          db,
          `SELECT s.*, p.code AS product_code, p.name_ko AS product_name
             FROM skus s JOIN products p ON p.id = s.product_id
            WHERE s.product_id = ? AND s.active = 1 ORDER BY s.is_default DESC, s.weight LIMIT 1`,
          product.id,
        )
      : null;
    if (!user || !farm || !product || !sku) continue;

    const harvested = daysAgo(ago);
    const recognition = {
      category: product.category,
      product: product.code,
      product_ko: product.name_ko,
      variety_guess: product.variety,
      quality_hint: '상' as const,
      confidence: 0.82,
      detected_issues: [],
      description_basis: ['사진 전체에서 색이 비교적 고르게 나타납니다.', '큰 상처로 보일 만한 뚜렷한 음영이 적습니다.'],
      alternatives: [],
    };
    const draft = writeProduct({
      product, sku, farm, farmerName: user.name, recognition,
      harvestedOn: harvested, today, aiSourceLabel: '로컬 색·질감 규칙 판정',
    });

    createListing(db, {
      farmerId: user.id,
      farmId: farm.id,
      productId: product.id,
      skuId: sku.id,
      title: draft.title,
      description: draft.description,
      imagePath: product.sample_image,
      quantity,
      unitPrice: sku.price,
      harvestedOn: harvested,
      aiAnalysis: recognition,
      aiConfidence: recognition.confidence,
      aiSource: 'seed',
      qualityHint: '상',
    });
  }
}
