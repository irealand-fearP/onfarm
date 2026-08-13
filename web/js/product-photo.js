// 상품 사진 규칙 — 판매자·소비자 화면이 **같은 판정을 공유한다.**
// 예전에는 소비자만 이 규칙을 쓰고 판매자는 api.js 의 imageOf() 로 image_path 를
// 그대로 띄워, 같은 상품이 한쪽은 실사·한쪽은 옛 일러스트로 보였다.
// 판정 로직을 두 벌 두면 반드시 어긋나므로 여기 한 곳에만 둔다.
import { el } from '/js/api.js';

/** 사진 파일이 없을 때 떨어질 자리표시. 품목이 늘어나도 화면이 깨지지 않게 한다. */
export const PHOTO_FALLBACK = '/img/sample/placeholder.svg';

/**
 * 상품 사진 고르기.
 * - 농민이 직접 촬영해 올린 사진(/uploads/...)은 그대로 쓰고 배지를 붙이지 않는다.
 * - 단, "사진 없이 시연" 버튼으로 올린 건은 파일명이 /uploads/demo- 로 시작한다.
 *   실제 농민 촬영본이 아니므로 사진은 그대로 쓰되 "시연용 이미지" 배지를 붙인다.
 *   (DB 컬럼·API 응답을 늘리지 않고 구분하려고 파일명 표식을 쓴다.)
 * - 시드 상품은 품목 코드와 파일명이 1:1로 맞는 실사 상품컷으로 폴백하고
 *   "시연용 이미지"를 표기한다. 무엇이 진짜 산지 사진인지 화면에서 구분돼야 한다.
 * (기존 일러스트 products.sample_image 는 더 이상 쓰지 않는다.)
 *
 * @returns {{src: string, demo: boolean}} demo=true 면 "시연용 이미지" 배지 대상
 */
export function productPhoto(listing) {
  const uploaded = typeof listing.image_path === 'string' && listing.image_path.startsWith('/uploads/');
  if (uploaded) return { src: listing.image_path, demo: listing.image_path.startsWith('/uploads/demo-') };
  return { src: `/img/products/${listing.product_code}.webp`, demo: true };
}

/** productPhoto 로 고른 사진을 <img> 로 만든다. 파일이 없으면 자리표시로 떨어진다. */
export function photoImg(listing, alt, props = {}) {
  return el('img', {
    src: productPhoto(listing).src,
    alt: alt ?? listing.title,
    loading: 'lazy',
    ...props,
    onerror: (event) => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = PHOTO_FALLBACK;
    },
  });
}
