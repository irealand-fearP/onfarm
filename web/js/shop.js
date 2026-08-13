// 소비자 홈 — 종류(1단) → 품목(2단) → 지역(3단) 3단 필터로 목록을 좁힌다.
// 서버 계약은 그대로다(GET /api/store/listings). 판매 중 목록을 한 번 받아
// 화면에서 걸러야 "실제로 상품이 있는" 종류·품목·지역만 노출할 수 있다.
import { $, api, el, money } from '/js/api.js';
import { isHarvestedToday, isInspected, isRunningOut, mountCartBadges, photoImg, productPhoto } from '/js/shop-ui.js';
import { mountDemoNav } from '/js/demo-nav.js';

mountCartBadges();
mountDemoNav('#demoNavSlot');

const cfg = await api('/api/config').catch(() => ({ products: [], allProducts: [] }));
const state = { category: '', product: '', region: '', query: '', quick: '' };

// products.category 값을 한국어로 노출한다. 노출 순서도 이 순서를 따른다.
const CATEGORY_LABELS = [
  ['fruit', '과일'],
  ['vegetable', '채소'],
  ['root', '뿌리채소'],
  ['seafood', '수산물'],
];

// 비활성 품목까지 포함한 품목 표(종류 판정·이름 표시에 쓴다).
const productByCode = new Map(
  [...cfg.products, ...(cfg.allProducts ?? [])].map((product) => [product.code, product]),
);

const QUICK_RULES = {
  inspected: isInspected,
  today: isHarvestedToday,
  last: isRunningOut,
};

const QUICK_TITLES = {
  inspected: '거점 검수 완료 상품',
  today: '오늘 수확한 상품',
  last: '마감 임박 상품',
};

// 준비 중 종류의 안내 문구(종류별로 다르게 쓸 수 있게 표에 둔다).
const COMING_SOON_NOTES = {
  seafood: '지역 수협·어촌계와 연계해 곧 열립니다.',
};

// 판매 중 상품 캐시. 종류·품목·지역 후보를 여기서 뽑는다.
let allListings = [];

/** 판매 중 물량이 있는 종류 코드 집합. */
function liveCategories() {
  return new Set(allListings.map(categoryOf));
}

/** 품목(products)은 있으나 판매 중 목록이 0건인 종류 = 준비 중. 상품이 등록되면 자동으로 정상 탭이 된다. */
function isComingSoon(code) {
  return Boolean(code) && !liveCategories().has(code);
}

function categoryOf(listing) {
  return productByCode.get(listing.product_code)?.category ?? '';
}

function productName(code) {
  return productByCode.get(code)?.name ?? code;
}

/** 종류·품목·지역 조건을 AND 로 적용한다(단계별로 끊어 후보 계산에도 재사용한다). */
function matchCategory(listing) {
  return !state.category || categoryOf(listing) === state.category;
}

function matchProduct(listing) {
  return !state.product || listing.product_code === state.product;
}

function matchRegion(listing) {
  return !state.region || listing.region_sido === state.region;
}

function renderCategoryTabs() {
  const box = $('#catTabs');
  box.replaceChildren();
  // 품목 마스터에 아예 없는 종류(예: 곡물)는 탭을 만들지 않는다. 없는 데이터로 탭을 지어내지 않는다.
  // 품목 표에 있는 종류만 탭이 된다(품목 행이 없는 곡물 같은 종류는 만들지 않는다).
  const registered = new Set([...productByCode.values()].map((product) => product.category));
  const tabs = [['', '전체'], ...CATEGORY_LABELS.filter(([code]) => registered.has(code))];

  for (const [code, label] of tabs) {
    const soon = isComingSoon(code);
    box.append(
      el(
        'button',
        {
          type: 'button',
          class: soon ? 'cat-tab is-soon' : 'cat-tab',
          'aria-pressed': String(state.category === code),
          onclick: () => {
            if (state.category === code) return;
            state.category = code;
            // 상위가 바뀌면 하위 선택은 되돌린다(남아 있으면 결과가 0건이 된다).
            state.product = '';
            state.region = '';
            renderAllFilters();
            load();
          },
        },
        // 준비 중 종류도 누를 수 있게 둔다. 눌러야 "왜 비어 있는지"를 안내할 수 있기 때문이다.
        soon
          ? [el('span', { text: label }), el('span', { class: 'soon-tag', text: '준비 중' })]
          : [el('span', { text: label })],
      ),
    );
  }
}

function renderItemStrip() {
  const box = $('#itemStrip');
  box.replaceChildren();
  const codes = [...new Set(allListings.filter(matchCategory).map((listing) => listing.product_code))];

  box.append(itemButton('', '전체', null));
  for (const code of codes) box.append(itemButton(code, productName(code), code));
}

/** 원형 썸네일 + 이름. 사진은 품목 코드와 1:1 인 상품컷을 원형으로 크롭해 쓴다. */
function itemButton(code, label, photoCode) {
  const thumb = el('span', { class: 'item-thumb' }, [
    photoCode
      ? el('img', {
          src: `/img/products/${photoCode}.webp`,
          alt: '',
          loading: 'lazy',
          onerror: (event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = '/img/sample/placeholder.svg';
          },
        })
      : el('span', { class: 'item-all', text: '전체', 'aria-hidden': 'true' }),
  ]);

  return el(
    'button',
    {
      type: 'button',
      class: 'item-pick',
      'aria-pressed': String(state.product === code),
      onclick: () => {
        state.product = state.product === code ? '' : code;
        // 품목을 고르면 그 품목의 종류 탭이 활성화돼야 한다.
        if (state.product) state.category = productByCode.get(state.product)?.category ?? state.category;
        if (!matchRegionStillPossible()) state.region = '';
        renderAllFilters();
        load();
      },
    },
    [thumb, el('span', { class: 'item-name', text: label })],
  );
}

/** 현재 선택 지역이 좁혀진 결과 안에 남아 있는지(없으면 지역 선택을 푼다). */
function matchRegionStillPossible() {
  if (!state.region) return true;
  return allListings.some((listing) => matchCategory(listing) && matchProduct(listing) && matchRegion(listing));
}

function renderRegionChips() {
  const box = $('#regionChips');
  box.replaceChildren();
  // 선택된 종류·품목 안에 실제로 있는 지역만 남긴다.
  const regions = [
    ...new Set(
      allListings.filter((listing) => matchCategory(listing) && matchProduct(listing)).map((l) => l.region_sido),
    ),
  ];

  for (const [key, label] of [['', '전체'], ...regions.map((r) => [r, r])]) {
    box.append(
      el('button', {
        type: 'button',
        'aria-pressed': String(state.region === key),
        text: label,
        onclick: () => {
          state.region = state.region === key ? '' : key;
          renderAllFilters();
          load();
        },
      }),
    );
  }
}

function renderAllFilters() {
  renderCategoryTabs();
  // 준비 중 종류는 보여줄 품목·지역이 없으므로 하위 2단을 아예 감춘다.
  const soon = isComingSoon(state.category);
  $('#itemStrip').hidden = soon;
  $('#regionChips').hidden = soon;
  if (soon) {
    $('#itemStrip').replaceChildren();
    $('#regionChips').replaceChildren();
    return;
  }
  renderItemStrip();
  renderRegionChips();
}

function renderQuickTiles() {
  for (const tile of document.querySelectorAll('.quick-tile')) {
    tile.setAttribute('aria-pressed', String(tile.dataset.quick === state.quick));
  }
}

function card(listing) {
  const region = `${listing.region_sigungu}${listing.region_detail ? ` ${listing.region_detail}` : ''}`;
  const photo = el('div', { class: 'goods-photo' }, [photoImg(listing)]);
  // 검수 배지는 거점이 실물을 확인한 상품에만 붙인다(AI 판정으로는 붙이지 않는다).
  if (isInspected(listing)) {
    photo.append(el('span', { class: 'goods-stamp', text: '검수 완료' }));
  }
  // 배지 판정은 productPhoto 한 곳에만 둔다(시드 이미지 + 시연용 업로드 모두 포함).
  if (productPhoto(listing).demo) {
    photo.append(el('span', { class: 'goods-demo', text: '시연용 이미지' }));
  }

  return el('a', { class: 'goods-card', href: `/shop/product?id=${listing.id}` }, [
    photo,
    el('p', { class: 'goods-farm' }, [
      el('span', { class: 'face', 'aria-hidden': 'true' }),
      el('span', { class: 'who', text: listing.farm_name }),
    ]),
    el('p', { class: 'goods-name', text: listing.title }),
    el('p', { class: 'goods-price', text: money(listing.unit_price) }),
    el('p', { class: 'goods-unit', text: `${listing.sku_label} · ${listing.remaining_quantity}개 남음 · ${region}` }),
  ]);
}

function headline() {
  if (state.query) return `“${state.query}” 검색 결과`;
  if (state.quick) return QUICK_TITLES[state.quick];
  const categoryName = CATEGORY_LABELS.find(([code]) => code === state.category)?.[1] ?? '';
  const label = [state.region, state.product ? productName(state.product) : categoryName]
    .filter(Boolean)
    .join(' ');
  return label ? `${label} 상품` : '오늘 올라온 농산물';
}

/** 판매 중 목록을 한 번만 받아 캐시한다(응답 형식·쿼리 계약은 그대로 둔다). */
async function fetchListings() {
  const { listings } = await api('/api/store/listings?limit=200');
  allListings = listings;
}

function load() {
  // 준비 중 종류는 빈 목록 대신 안내만 보여준다.
  if (isComingSoon(state.category)) {
    const label = CATEGORY_LABELS.find(([code]) => code === state.category)?.[1] ?? '';
    $('#grid').replaceChildren();
    $('#empty').hidden = true;
    $('#comingSoon').hidden = false;
    $('#comingSoonTitle').textContent = `${label}은 준비 중입니다`;
    $('#comingSoonDesc').textContent = COMING_SOON_NOTES[state.category] ?? '곧 열립니다.';
    $('#listCount').textContent = '0건';
    $('#listTitle').textContent = `${label} 준비 중`;
    return;
  }
  $('#comingSoon').hidden = true;

  const keyword = state.query.toLocaleLowerCase('ko-KR');
  const rule = QUICK_RULES[state.quick];

  const listings = allListings.filter((listing) => {
    if (!matchCategory(listing) || !matchProduct(listing) || !matchRegion(listing)) return false;
    if (rule && !rule(listing)) return false;
    if (!keyword) return true;
    return [listing.title, listing.product_name, listing.farm_name, listing.region_sido, listing.region_sigungu]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ko-KR')
      .includes(keyword);
  });

  const grid = $('#grid');
  grid.replaceChildren();
  for (const listing of listings) grid.append(card(listing));

  $('#empty').hidden = listings.length > 0;
  $('#listCount').textContent = `${listings.length}건`;
  $('#listTitle').textContent = headline();
}

$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = $('#searchInput').value.trim();
  load();
});

for (const tile of document.querySelectorAll('.quick-tile')) {
  tile.addEventListener('click', () => {
    state.quick = state.quick === tile.dataset.quick ? '' : tile.dataset.quick;
    renderQuickTiles();
    load();
  });
}

// 탭바의 "검색"은 별도 화면 대신 이 화면의 검색창으로 데려간다(없는 화면을 만들지 않는다).
$('#tabSearch')?.addEventListener('click', () => {
  $('#searchInput').focus();
  $('#searchForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// 필터 초기화 — 0건일 때 사용자가 한 번에 빠져나올 수 있게 한다.
$('#resetFilters')?.addEventListener('click', () => {
  state.category = '';
  state.product = '';
  state.region = '';
  state.quick = '';
  state.query = '';
  $('#searchInput').value = '';
  renderQuickTiles();
  renderAllFilters();
  load();
});

// 준비 중 안내에서 농산물(전체)로 되돌아가기.
$('#comingSoonBack')?.addEventListener('click', () => {
  state.category = '';
  state.product = '';
  state.region = '';
  renderAllFilters();
  load();
});

/** 홈 하단 배너 등 외부 링크에서 들어올 때 ?category= 로 종류 탭을 미리 골라 준다.
 *  품목 표에 없는 값이면 조용히 무시하고 전체 목록을 보여준다(에러 화면을 띄우지 않는다). */
function applyCategoryFromUrl() {
  const code = new URLSearchParams(location.search).get('category');
  if (!code) return;
  const registered = new Set([...productByCode.values()].map((product) => product.category));
  if (CATEGORY_LABELS.some(([known]) => known === code) && registered.has(code)) state.category = code;
}

renderQuickTiles();
await fetchListings();
applyCategoryFromUrl();
renderAllFilters();
load();
