// 소비자 홈 — 종류(1단) → 품목(2단) → 지역(3단) 3단 필터로 목록을 좁힌다.
// 서버 계약은 그대로다(GET /api/store/listings). 판매 중 목록을 한 번 받아
// 화면에서 걸러야 "실제로 상품이 있는" 종류·품목·지역만 노출할 수 있다.
import { $, api, el, money } from '/js/api.js';
import { isInspected, mountCartBadges, photoImg, productPhoto } from '/js/shop-ui.js';
import { PHOTO_FALLBACK } from '/js/product-photo.js';
import { mountDemoNav } from '/js/demo-nav.js';
import { mountPromoCarousel } from '/js/promo-carousel.js';
import { mountEdgeScrollers } from '/js/edge-scroll.js';

mountCartBadges();
mountDemoNav('#demoNavSlot');
mountPromoCarousel('#promoCarousel');
// 품목 칩·종류 탭은 개수가 늘면 화면 밖으로 나간다. 마우스만 있는 데스크톱에서도 밀 수 있게 한다.
mountEdgeScrollers();

const cfg = await api('/api/config').catch(() => ({ products: [], allProducts: [] }));
// 한 페이지에 보여줄 상품 수. 이보다 적으면 페이지 이동 자체를 노출하지 않는다.
const PAGE_SIZE = 10;
const state = { category: '', product: '', region: '', query: '', page: 1 };

// products.category 값을 한국어로 노출한다. 노출 순서도 이 순서를 따른다.
const CATEGORY_LABELS = [
  ['fruit', '과일'],
  ['vegetable', '채소'],
  // 코드는 grain 그대로 두고 라벨만 바꾼다(?category=grain 링크·데이터에 영향 없음).
  // 홈 캐러셀 3번 배너의 "쌀·잡곡" 표기와 맞춘다.
  ['grain', '쌀·잡곡'],
  ['seafood', '수산물'],
];

// 비활성 품목까지 포함한 품목 표(종류 판정·이름 표시에 쓴다).
const productByCode = new Map(
  [...cfg.products, ...(cfg.allProducts ?? [])].map((product) => [product.code, product]),
);

// 준비 중 종류의 안내 문구(종류별로 다르게 쓸 수 있게 표에 둔다).
// 지금은 쌀·수산물까지 전부 판매 중이라 비어 있다. 표를 없애지는 않는다 —
// 준비 중 판정은 데이터 기반 자동이라, 새 종류가 생기면 여기 한 줄만 추가하면 된다.
// (비어 있는 동안에는 아래 기본 문구 '곧 열립니다.'가 쓰인다.)
const COMING_SOON_NOTES = {};

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
            reloadFromFirstPage();
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
  // 품목 카탈로그 순서로 고정한다. 판매 목록 등록순을 그대로 쓰면 새 상품이 올라올 때마다
  // 칩 순서가 뒤바뀌어, 같은 화면을 다시 봐도 늘 다른 자리에 있게 된다.
  const catalogOrder = [...productByCode.keys()];
  const codes = [...new Set(allListings.filter(matchCategory).map((listing) => listing.product_code))].sort(
    (a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b),
  );

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
            event.currentTarget.src = PHOTO_FALLBACK;
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
        reloadFromFirstPage();
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
          reloadFromFirstPage();
        },
      }),
    );
  }
}

function renderAllFilters() {
  renderCategoryTabs();
  // 준비 중 종류는 보여줄 품목·지역이 없으므로 하위 2단을 아예 감춘다.
  const soon = isComingSoon(state.category);
  // 감출 때는 칩 줄 자체가 아니라 감싼 상자를 감춘다(화살표·페이드도 함께 사라져야 한다).
  $('#itemStripBox').hidden = soon;
  $('#regionChips').hidden = soon;
  if (soon) {
    $('#itemStrip').replaceChildren();
    $('#regionChips').replaceChildren();
    return;
  }
  renderItemStrip();
  renderRegionChips();
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
  const categoryName = CATEGORY_LABELS.find(([code]) => code === state.category)?.[1] ?? '';
  const label = [state.region, state.product ? productName(state.product) : categoryName]
    .filter(Boolean)
    .join(' ');
  return label ? `${label} 상품` : '오늘 올라온 농수산물';
}

/** 판매 중 목록을 한 번만 받아 캐시한다(응답 형식·쿼리 계약은 그대로 둔다). */
async function fetchListings() {
  const { listings } = await api('/api/store/listings?limit=200');
  allListings = listings;
}

/** 필터·검색이 바뀌면 늘 1페이지로 돌아간다(3페이지에 머물면 빈 화면이 뜬다). */
function reloadFromFirstPage() {
  state.page = 1;
  load();
}

/** 페이지를 옮기면 목록 맨 위로 데려간다(제자리에 있으면 바뀐 걸 알아채지 못한다). */
function goToPage(page) {
  state.page = page;
  load();
  document.querySelector('.list-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 이전 · 번호 · 다음 형태의 페이지 이동. 한 페이지(=10개 이하)면 아예 그리지 않는다. */
function renderPager(totalPages) {
  const box = $('#pager');
  box.replaceChildren();
  if (totalPages <= 1) return;

  box.append(pagerArrow('prev', '이전 페이지', state.page - 1, state.page === 1));
  for (const page of pageNumbers(state.page, totalPages)) {
    box.append(
      el('button', {
        type: 'button',
        class: 'pager-num',
        text: String(page),
        'aria-label': `${page}페이지${page === state.page ? ' (현재 페이지)' : ''}`,
        ...(page === state.page ? { 'aria-current': 'page' } : {}),
        onclick: () => goToPage(page),
      }),
    );
  }
  box.append(pagerArrow('next', '다음 페이지', state.page + 1, state.page === totalPages));
}

function pagerArrow(kind, label, target, disabled) {
  return el('button', {
    type: 'button',
    class: `pager-arrow pager-arrow--${kind}`,
    text: kind === 'prev' ? '‹' : '›',
    'aria-label': label,
    ...(disabled ? { disabled: 'disabled' } : {}),
    onclick: () => goToPage(target),
  });
}

/** 번호가 많아져도 줄이 넘치지 않게 현재 페이지 주변 최대 5개만 보여준다. */
function pageNumbers(current, totalPages) {
  const WINDOW = 5;
  let start = Math.max(1, current - Math.floor(WINDOW / 2));
  const end = Math.min(totalPages, start + WINDOW - 1);
  start = Math.max(1, end - WINDOW + 1);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function load() {
  // 준비 중 종류는 빈 목록 대신 안내만 보여준다.
  if (isComingSoon(state.category)) {
    const label = CATEGORY_LABELS.find(([code]) => code === state.category)?.[1] ?? '';
    $('#grid').replaceChildren();
    $('#pager').replaceChildren();
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

  const listings = allListings.filter((listing) => {
    if (!matchCategory(listing) || !matchProduct(listing) || !matchRegion(listing)) return false;
    if (!keyword) return true;
    return [listing.title, listing.product_name, listing.farm_name, listing.region_sido, listing.region_sigungu]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ko-KR')
      .includes(keyword);
  });

  // 전체 건수는 그대로 알려 주고(“12건”), 화면에는 현재 페이지 몫만 그린다.
  const totalPages = Math.max(1, Math.ceil(listings.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const pageItems = listings.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const grid = $('#grid');
  grid.replaceChildren();
  for (const listing of pageItems) grid.append(card(listing));
  renderPager(totalPages);

  $('#empty').hidden = listings.length > 0;
  $('#listCount').textContent = `${listings.length}건`;
  $('#listTitle').textContent = headline();
}

$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = $('#searchInput').value.trim();
  reloadFromFirstPage();
});

// 탭바의 "검색"은 별도 화면 대신 이 화면의 검색창으로 데려간다(없는 화면을 만들지 않는다).
$('#tabSearch')?.addEventListener('click', () => {
  $('#searchInput').focus();
  $('#searchForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/** 검색어·종류·품목·지역을 모두 "전체"로 되돌린다(홈에 처음 들어온 상태).
 *  주소의 ?category= 도 지운다 — 남겨 두면 새로고침 때 필터가 되살아나 초기화가 아니게 된다. */
function resetAll() {
  state.category = '';
  state.product = '';
  state.region = '';
  state.query = '';
  state.page = 1;
  $('#searchInput').value = '';
  if (location.search) history.replaceState(null, '', location.pathname);
  renderAllFilters();
  load();
}

// 필터 초기화 — 0건일 때 사용자가 한 번에 빠져나올 수 있게 한다.
$('#resetFilters')?.addEventListener('click', resetAll);

// 검색창의 X(네이티브 지우기)도 같은 초기화로 묶는다.
// 검색어만 지우면 필터는 남아 "초기화했다"는 느낌과 화면이 어긋나기 때문이다.
// search 이벤트는 X를 눌렀을 때(그리고 엔터) 발생한다. 값이 빈 경우만 전체 초기화로 본다.
$('#searchInput').addEventListener('search', (event) => {
  if (event.currentTarget.value !== '') return;
  resetAll();
  // 지운 뒤 바로 다시 칠 수 있게 포커스는 검색창에 남긴다.
  event.currentTarget.focus();
});

// 준비 중 안내에서 전체 목록으로 되돌아가기.
$('#comingSoonBack')?.addEventListener('click', () => {
  state.category = '';
  state.product = '';
  state.region = '';
  renderAllFilters();
  load();
});

/** 홈 상단 배너 등 외부 링크에서 들어올 때 ?category= 로 종류 탭을 미리 골라 준다.
 *  품목 표에 없는 값이면 조용히 무시하고 전체 목록을 보여준다(에러 화면을 띄우지 않는다). */
function applyCategoryFromUrl() {
  const code = new URLSearchParams(location.search).get('category');
  if (!code) return;
  const registered = new Set([...productByCode.values()].map((product) => product.category));
  if (CATEGORY_LABELS.some(([known]) => known === code) && registered.has(code)) state.category = code;
}

await fetchListings();
applyCategoryFromUrl();
renderAllFilters();
load();
