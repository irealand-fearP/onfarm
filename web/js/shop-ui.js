// 소비자 화면 공용 조각.
// 상품 사진 규칙은 판매자 화면과 함께 쓰므로 product-photo.js 한 곳에 있다.
// 여기서는 기존 import 경로를 깨뜨리지 않도록 그대로 다시 내보내기만 한다.
export { productPhoto, photoImg, PHOTO_FALLBACK } from '/js/product-photo.js';

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
