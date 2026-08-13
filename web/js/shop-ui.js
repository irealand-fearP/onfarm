// 소비자 화면 공용 조각 — 상품 사진 규칙과 상태 판정을 한 곳에 모은다.
import { el } from '/js/api.js';

/**
 * 상품 사진 고르기.
 * - 농민이 직접 촬영해 올린 사진(/uploads/...)은 그대로 쓰고 배지를 붙이지 않는다.
 * - 단, "사진 없이 시연" 버튼으로 올린 건은 파일명이 /uploads/demo- 로 시작한다.
 *   실제 농민 촬영본이 아니므로 사진은 그대로 쓰되 "시연용 이미지" 배지를 붙인다.
 *   (DB 컬럼·API 응답을 늘리지 않고 구분하려고 파일명 표식을 쓴다.)
 * - 시드 상품은 품목 코드와 파일명이 1:1로 맞는 실사 상품컷으로 폴백하고
 *   "시연용 이미지"를 표기한다. 무엇이 진짜 산지 사진인지 화면에서 구분돼야 한다.
 * (기존 일러스트 products.sample_image 는 더 이상 쓰지 않는다.)
 */
export function productPhoto(listing) {
  const uploaded = typeof listing.image_path === 'string' && listing.image_path.startsWith('/uploads/');
  if (uploaded) return { src: listing.image_path, demo: listing.image_path.startsWith('/uploads/demo-') };
  return { src: `/img/products/${listing.product_code}.webp`, demo: true };
}

/** 사진 파일이 없을 때만 자리표시로 떨어진다(품목이 늘어나도 화면이 깨지지 않게). */
export function photoImg(listing, alt) {
  return el('img', {
    src: productPhoto(listing).src,
    alt: alt ?? listing.title,
    loading: 'lazy',
    onerror: (event) => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = '/img/sample/placeholder.svg';
    },
  });
}

/** 거점 실물 검수를 통과했는가 (AI 판정과 다르다). */
export function isInspected(listing) {
  return ['hub_passed', 'ready_to_ship', 'delivered'].includes(listing.inspection_status);
}

/** 하단 탭바·상단 바의 장바구니 개수를 함께 갱신한다. */
export function mountCartBadges(selector = '[data-cart-count]') {
  const render = () => {
    let total = 0;
    try {
      total = (JSON.parse(localStorage.getItem('onfarm.cart.v1') ?? '[]') || []).reduce(
        (sum, item) => sum + (Number(item?.quantity) || 0),
        0,
      );
    } catch {
      total = 0;
    }
    for (const node of document.querySelectorAll(selector)) {
      node.textContent = String(total);
      node.hidden = total <= 0;
    }
  };
  document.addEventListener('cart:changed', render);
  render();
}
