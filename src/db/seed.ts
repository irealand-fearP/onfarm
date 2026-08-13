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
 *
 * sample 은 products.sample_image 컬럼 값이다. 화면은 판매자·소비자 모두
 * /js/product-photo.js 의 productPhoto() 로 실사 상품컷(/img/products/<code>.webp)을
 * 고르므로 이 값은 카드에 쓰이지 않는다. 컬럼이 비면 안 되니 공용 플레이스홀더로 통일한다.
 * (품목별 옛 일러스트는 아무 데서도 참조하지 않아 삭제했다.)
 */
export const SEED_PRODUCTS: SeedProduct[] = [
  {
    code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배', emoji: '🍐',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'pear_shingo_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 29000, isDefault: true },
      { code: 'pear_shingo_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 52000 },
    ],
  },
  {
    code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사', emoji: '🍎',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'apple_fuji_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 32000, isDefault: true },
      { code: 'apple_fuji_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 58000 },
    ],
  },
  {
    code: 'sweet_potato', name_ko: '고구마', category: 'vegetable', variety: '호박고구마', emoji: '🍠',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'sweet_potato_3kg', label: '3kg 한 상자', weight: 3, unit: 'kg', price: 15000, isDefault: true },
      { code: 'sweet_potato_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 23000 },
    ],
  },
  {
    code: 'potato', name_ko: '감자', category: 'vegetable', variety: '수미감자', emoji: '🥔',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'potato_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 14000, isDefault: true },
      { code: 'potato_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 25000 },
    ],
  },
  {
    code: 'onion', name_ko: '양파', category: 'vegetable', variety: '중만생종', emoji: '🧅',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'onion_3kg', label: '3kg 한 망', weight: 3, unit: 'kg', price: 9000, isDefault: true },
      { code: 'onion_10kg', label: '10kg 한 망', weight: 10, unit: 'kg', price: 22000 },
    ],
  },
  {
    code: 'mandarin', name_ko: '감귤', category: 'fruit', variety: '노지감귤', emoji: '🍊',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'mandarin_3kg', label: '3kg 한 상자', weight: 3, unit: 'kg', price: 18000, isDefault: true },
      { code: 'mandarin_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 27000 },
    ],
  },
  {
    code: 'red_pepper', name_ko: '건고추', category: 'vegetable', variety: '태양초', emoji: '🌶️',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'red_pepper_600g', label: '600g 한 봉', weight: 0.6, unit: 'kg', price: 20000, isDefault: true },
      { code: 'red_pepper_1kg', label: '1kg 한 봉', weight: 1, unit: 'kg', price: 32000 },
    ],
  },
  {
    code: 'peach', name_ko: '복숭아', category: 'fruit', variety: '황도', emoji: '🍑',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'peach_4kg', label: '4kg 한 상자', weight: 4, unit: 'kg', price: 32000, isDefault: true },
      { code: 'peach_2kg', label: '2kg 한 상자', weight: 2, unit: 'kg', price: 19000 },
    ],
  },
  {
    // 쌀(곡물). 상품컷 /img/products/rice.webp 가 준비돼 정식 판매 품목으로 연다.
    code: 'rice', name_ko: '쌀', category: 'grain', variety: '삼광', emoji: '🌾',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'rice_samgwang_10kg', label: '10kg 한 포대', weight: 10, unit: 'kg', price: 33000, isDefault: true },
      { code: 'rice_samgwang_20kg', label: '20kg 한 포대', weight: 20, unit: 'kg', price: 62000 },
    ],
  },
  {
    // 마늘. 상품컷 /img/products/garlic.webp 준비 완료.
    // '접'은 마늘 고유 단위(100통)라 라벨에 남기고, 무게 컬럼은 다른 품목과 같은 kg 로 환산해 둔다.
    code: 'garlic', name_ko: '마늘', category: 'vegetable', variety: '남도마늘', emoji: '🧄',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'garlic_1kg', label: '1kg 한 망', weight: 1, unit: 'kg', price: 12000, isDefault: true },
      { code: 'garlic_jeop', label: '한 접(100통·약 3kg)', weight: 3, unit: 'kg', price: 33000 },
    ],
  },
  {
    // 상품컷이 청포도라 품종을 샤인머스캣으로 맞춘다(사진과 글이 어긋나면 안 된다).
    code: 'grape', name_ko: '포도', category: 'fruit', variety: '샤인머스캣', emoji: '🍇',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'grape_2kg', label: '2kg 한 상자(2~3송이)', weight: 2, unit: 'kg', price: 32000, isDefault: true },
      { code: 'grape_4kg', label: '4kg 한 상자', weight: 4, unit: 'kg', price: 58000 },
    ],
  },
  {
    // 상품컷이 단감이라 품종을 단감(부유)으로 맞춘다. 떫은감·곶감용과 혼동되면 안 된다.
    code: 'persimmon', name_ko: '감', category: 'fruit', variety: '부유단감', emoji: '🟠',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'persimmon_5kg', label: '5kg 한 상자', weight: 5, unit: 'kg', price: 25000, isDefault: true },
      { code: 'persimmon_10kg', label: '10kg 한 상자', weight: 10, unit: 'kg', price: 45000 },
    ],
  },
  {
    // 수산물 3종 + 전복. 상품컷이 준비돼 정식 판매 품목으로 연다(더 이상 Phase 2 자리가 아니다).
    // 생선·오징어는 '마리'로 사는 감각이라 라벨에 마릿수를 쓰고, 무게는 kg 로 함께 적어 비교가 되게 한다.
    code: 'mackerel', name_ko: '고등어', category: 'seafood', variety: '선망 고등어', emoji: '🐟',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'mackerel_4mi', label: '4마리(약 1.6kg)', weight: 1.6, unit: 'kg', price: 22000, isDefault: true },
      { code: 'mackerel_8mi', label: '8마리(약 3.2kg)', weight: 3.2, unit: 'kg', price: 40000 },
    ],
  },
  {
    code: 'shrimp', name_ko: '새우', category: 'seafood', variety: '흰다리새우', emoji: '🦐',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'shrimp_1kg', label: '1kg 한 상자', weight: 1, unit: 'kg', price: 38000, isDefault: true },
      { code: 'shrimp_2kg', label: '2kg 한 상자', weight: 2, unit: 'kg', price: 72000 },
    ],
  },
  {
    code: 'squid', name_ko: '오징어', category: 'seafood', variety: '살오징어', emoji: '🦑',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'squid_3mi', label: '3마리(약 1.2kg)', weight: 1.2, unit: 'kg', price: 18000, isDefault: true },
      { code: 'squid_6mi', label: '6마리(약 2.4kg)', weight: 2.4, unit: 'kg', price: 33000 },
    ],
  },
  {
    // 전복도 함께 연다. 홈 캐러셀이 "전복 보러 가기"로 안내하므로 실제로 살 수 있어야 한다.
    code: 'abalone', name_ko: '전복', category: 'seafood', variety: '활전복', emoji: '🐚',
    sample: '/img/sample/placeholder.svg',
    skus: [
      { code: 'abalone_1kg', label: '1kg (10미)', weight: 1, unit: 'kg', price: 45000, isDefault: true },
      { code: 'abalone_500g', label: '500g (5미)', weight: 0.5, unit: 'kg', price: 24000 },
    ],
  },
];

const SEED_HUBS = [
  { name: '천안 성환 로컬푸드 거점', region: '충남 천안시', address: '충남 천안시 서북구 성환읍' },
  { name: '충주 로컬푸드 거점', region: '충북 충주시', address: '충북 충주시' },
  { name: '제주 서귀포 거점', region: '제주 서귀포시', address: '제주 서귀포시' },
  // 수산물은 내륙 거점이 받을 수 없다. 실제 위판·산지가 있는 남해안·동해안에 거점을 둔다.
  { name: '통영 수산물 거점', region: '경남 통영시', address: '경남 통영시 도남동' },
  { name: '포항 구룡포 수산 거점', region: '경북 포항시', address: '경북 포항시 남구 구룡포읍' },
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
  // 쌀은 과수원·감귤원이 팔면 어색해 벼농사 농가를 따로 둔다. 성환읍은 실제 벼 재배지이자 0번 거점 소재지라 지역·거점이 앞뒤가 맞는다.
  { name: '정순임', phone: '010-1234-0005', farm: '성환들녘 쌀농사', sido: '충남', sigungu: '천안시', detail: '성환읍', hubIndex: 0 },
  // 감자·양파는 밭작물이라 과수원·감귤원과 성격이 다르다. 기존 '정자네 텃밭' 한 곳에 4건을 몰지 않도록 밭작물 전문 농가를 따로 둔다.
  // 제천 백운면은 감자·양파를 실제로 재배하는 지역이고 1번(충주) 거점 권역이라 지역·거점 연결도 맞는다.
  { name: '한영식', phone: '010-1234-0006', farm: '백운 밭작물농장', sido: '충북', sigungu: '제천시', detail: '백운면', hubIndex: 1 },
  // 마늘은 밭작물이지만 백운 밭작물농장(감자·양파)에 3건을 몰지 않게 따로 둔다.
  // 서산 육쪽마늘은 실제 주산지이고 충남이라 0번(천안 성환) 거점 권역과 맞는다.
  { name: '정길수', phone: '010-1234-0007', farm: '서산 육쪽마늘밭', sido: '충남', sigungu: '서산시', detail: '부석면', hubIndex: 0 },
  // 포도(샤인머스캣)·단감은 과수라 기존 과수 농가에 붙일 수도 있으나 만수농원이 이미 2건이다.
  // 영동은 포도·감을 함께 내는 실제 과수 산지이고 충북이라 1번(충주) 거점 권역과 맞는다.
  { name: '조막래', phone: '010-1234-0008', farm: '영동 과일마을 농원', sido: '충북', sigungu: '영동군', detail: '심천면', hubIndex: 1 },
  // 여기부터는 어가(수산물). 농가가 수산물을 팔면 안 되므로 생산자 자체를 분리한다.
  { name: '강영자', phone: '010-1234-0009', farm: '성산포 해녀어촌계', sido: '제주', sigungu: '서귀포시', detail: '성산읍', hubIndex: 2 },
  { name: '문태호', phone: '010-1234-0010', farm: '통영 선망 어가', sido: '경남', sigungu: '통영시', detail: '도남동', hubIndex: 3 },
  // 흰다리새우는 고성·통영 일대 양식이 실제로 있고 3번(통영) 거점 권역이다. 통영 어가 한 곳에 2건을 몰지 않는다.
  { name: '배순옥', phone: '010-1234-0011', farm: '고성 흰다리새우 양식장', sido: '경남', sigungu: '고성군', detail: '하이면', hubIndex: 3 },
  { name: '최기환', phone: '010-1234-0012', farm: '구룡포 앞바다 어가', sido: '경북', sigungu: '포항시', detail: '남구 구룡포읍', hubIndex: 4 },
];

/** 시연용 초기 매물: [농부 index, 품목 code, 수량, 며칠 전 수확] */
const SEED_LISTINGS: Array<[number, string, number, number]> = [
  [0, 'pear', 8, 0],
  [1, 'apple', 6, 0],
  [2, 'red_pepper', 12, 1],
  [3, 'mandarin', 10, 0],
  [2, 'sweet_potato', 5, 1],
  // 복숭아는 충주(앙성)가 사과와 함께 나는 과수 주산지라 기존 과수 농가(만수농원)에 붙인다.
  [1, 'peach', 7, 0],
  // 감자·양파는 밭작물 전문 농가(백운 밭작물농장) 몫.
  [5, 'potato', 9, 2],
  [5, 'onion', 15, 1],
  [4, 'rice', 20, 3],
  // 신규 농산물 3종.
  [6, 'garlic', 14, 2],
  [7, 'grape', 9, 0],
  [7, 'persimmon', 11, 1],
  // 수산물 4종 — 어가별로 한 건씩 나눠 담는다.
  [8, 'abalone', 6, 0],
  [9, 'mackerel', 12, 1],
  [10, 'shrimp', 8, 2],
  [11, 'squid', 10, 3],
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

  // 거점 담당자는 소속 거점에 묶인다(자기 거점 물량만 처리).
  const others: Array<[string, string, string, number | null]> = [
    ['consumer', '장바구니', '010-5555-1000', null],
    ['consumer', '최수민', '010-5555-1001', null],
    ['hub_operator', '성환거점 담당자', '010-7777-2000', hubs[0]?.id ?? null],
    ['hub_operator', '충주거점 담당자', '010-7777-2001', hubs[1]?.id ?? null],
    // 수산물 거점에도 담당자가 있어야 그 거점 물량을 검수할 수 있다(담당자 없는 거점 = 검수 불가).
    ['hub_operator', '서귀포거점 담당자', '010-7777-2002', hubs[2]?.id ?? null],
    ['hub_operator', '통영거점 담당자', '010-7777-2003', hubs[3]?.id ?? null],
    ['hub_operator', '포항거점 담당자', '010-7777-2004', hubs[4]?.id ?? null],
    ['admin', '운영자', '010-9999-3000', null],
  ];
  for (const [role, name, phone, hubId] of others) {
    if (!one(db, 'SELECT id FROM users WHERE name = ? AND role = ?', name, role)) {
      run(db, 'INSERT INTO users (role, name, phone, hub_id) VALUES (?,?,?,?)', role, name, phone, hubId);
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
