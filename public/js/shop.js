// 소비자 홈 — 검색·퀵조건·지역/품목 칩으로 목록을 좁힌다.
// 서버 계약은 그대로다(GET /api/store/listings). 퀵 조건은 응답을 화면에서 거른다.
import { $, api, el, money } from '/js/api.js';
import { isHarvestedToday, isInspected, isRunningOut, mountCartBadges, photoImg } from '/js/shop-ui.js';

mountCartBadges();

const cfg = await api('/api/config').catch(() => ({ products: [] }));
const state = { product: '', region: '', query: '', quick: '' };

const REGION_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'region:충남', label: '충남' },
  { key: 'region:충북', label: '충북' },
  { key: 'region:제주', label: '제주' },
];

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

function renderFilters() {
  const box = $('#filters');
  box.replaceChildren();
  const options = [
    ...REGION_FILTERS,
    ...cfg.products.map((product) => ({ key: `product:${product.code}`, label: product.name })),
  ];

  for (const option of options) {
    const active =
      (option.key === 'all' && !state.product && !state.region) ||
      (option.key === `product:${state.product}` && state.product) ||
      (option.key === `region:${state.region}` && state.region);

    box.append(
      el('button', {
        type: 'button',
        'aria-pressed': String(Boolean(active)),
        text: option.label,
        onclick: () => {
          if (option.key === 'all') {
            state.product = '';
            state.region = '';
          } else if (option.key.startsWith('product:')) {
            state.product = option.key.slice(8) === state.product ? '' : option.key.slice(8);
          } else {
            state.region = option.key.slice(7) === state.region ? '' : option.key.slice(7);
          }
          renderFilters();
          void load();
        },
      }),
    );
  }
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
  if (!listing.image_path?.startsWith('/uploads/')) {
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
  const productName = cfg.products.find((product) => product.code === state.product)?.name ?? '';
  const filterName = [state.region, productName].filter(Boolean).join(' ');
  return filterName ? `${filterName} 상품` : '오늘 올라온 농산물';
}

async function load() {
  const params = new URLSearchParams();
  if (state.product) params.set('product', state.product);
  if (state.region) params.set('region', state.region);
  const { listings: allListings } = await api(`/api/store/listings?${params.toString()}`);

  const keyword = state.query.toLocaleLowerCase('ko-KR');
  let listings = keyword
    ? allListings.filter((listing) =>
        [listing.title, listing.product_name, listing.farm_name, listing.region_sido, listing.region_sigungu]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('ko-KR')
          .includes(keyword),
      )
    : allListings;

  const rule = QUICK_RULES[state.quick];
  if (rule) listings = listings.filter(rule);

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
  void load();
});

for (const tile of document.querySelectorAll('.quick-tile')) {
  tile.addEventListener('click', () => {
    state.quick = state.quick === tile.dataset.quick ? '' : tile.dataset.quick;
    renderQuickTiles();
    void load();
  });
}

// 탭바의 "검색"은 별도 화면 대신 이 화면의 검색창으로 데려간다(없는 화면을 만들지 않는다).
$('#tabSearch')?.addEventListener('click', () => {
  $('#searchInput').focus();
  $('#searchForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

renderQuickTiles();
renderFilters();
await load();
