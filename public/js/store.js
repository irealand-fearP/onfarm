// 소비자 매장 메인
import { $, api, el, imageOf, money } from '/js/api.js';
import { mountCartCount } from '/js/cart.js';

mountCartCount();

const cfg = await api('/api/config').catch(() => ({ products: [] }));
const state = { product: '', region: '' };

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'region:충남', label: '충남' },
  { key: 'region:충북', label: '충북' },
  { key: 'region:제주', label: '제주' },
];

function renderFilters() {
  const box = $('#filters');
  box.replaceChildren();
  const options = [
    ...FILTERS,
    ...cfg.products.map((p) => ({ key: `product:${p.code}`, label: `${p.emoji ?? ''} ${p.name}`.trim() })),
  ];
  for (const opt of options) {
    const active =
      (opt.key === 'all' && !state.product && !state.region) ||
      (opt.key === `product:${state.product}` && state.product) ||
      (opt.key === `region:${state.region}` && state.region);
    box.append(
      el('button', {
        type: 'button',
        'aria-pressed': String(Boolean(active)),
        text: opt.label,
        onclick: () => {
          if (opt.key === 'all') {
            state.product = '';
            state.region = '';
          } else if (opt.key.startsWith('product:')) {
            state.product = opt.key.slice(8) === state.product ? '' : opt.key.slice(8);
            state.region = '';
          } else {
            state.region = opt.key.slice(7) === state.region ? '' : opt.key.slice(7);
            state.product = '';
          }
          renderFilters();
          load();
        },
      }),
    );
  }
}

function card(listing) {
  const region = `${listing.region_sigungu}${listing.region_detail ? ` ${listing.region_detail}` : ''}`;
  return el('a', { class: 'product-card', href: `/store/product?id=${listing.id}` }, [
    el('img', { class: 'thumb', src: imageOf(listing), alt: listing.title, loading: 'lazy' }),
    el('div', { class: 'body' }, [
      el('div', { class: 'farm', text: `${region} · ${listing.farm_name}` }),
      el('div', { class: 'name', text: listing.title }),
      el('div', { class: 'meta' }, [
        el('span', { text: listing.sku_label }),
        el('span', { text: `남은 ${listing.remaining_quantity}` }),
      ]),
      el('div', { class: 'price', text: money(listing.unit_price) }),
    ]),
  ]);
}

async function load() {
  const params = new URLSearchParams();
  if (state.product) params.set('product', state.product);
  if (state.region) params.set('region', state.region);
  const { listings } = await api(`/api/store/listings?${params.toString()}`);

  const grid = $('#grid');
  grid.replaceChildren();
  for (const listing of listings) grid.append(card(listing));

  $('#empty').hidden = listings.length > 0;
  $('#listCount').textContent = `${listings.length}건`;
  $('#listTitle').textContent = state.product
    ? `${cfg.products.find((p) => p.code === state.product)?.name ?? ''} 상품`
    : state.region
      ? `${state.region} 산지`
      : '오늘 올라온 농산물';
}

renderFilters();
await load();
