// 판매자 화면 밀도(크게 / 보통) 전환.
// 디자인을 두 벌 만들지 않고 seller.css 의 기준 단위 --u 하나만 바꾼다.
// 기본값은 '크게' — 고령 사용자가 아무것도 하지 않아도 손해 보지 않는다.

const KEY = 'onfarm.seller.density';

/** 저장된 값이 'compact' 일 때만 보통이고, 그 밖(없음·이상값)은 전부 크게. */
export function currentDensity() {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'large';
  } catch {
    return 'large';
  }
}

export function applyDensity(density) {
  const compact = density === 'compact';
  if (!document.body) return compact ? 'compact' : 'large';
  if (compact) document.body.setAttribute('data-density', 'compact');
  else document.body.removeAttribute('data-density');
  try {
    localStorage.setItem(KEY, compact ? 'compact' : 'large');
  } catch {
    /* 저장 실패해도 이번 화면에는 적용된다 */
  }
  return compact ? 'compact' : 'large';
}

/**
 * 우측 상단 토글 버튼 1탭으로 크게 ↔ 보통 전환.
 * 버튼 글자는 '다음에 무엇이 되는지'가 아니라 '지금 무엇을 할 수 있는지'로 읽히게 둔다.
 *  - 지금 크게  → '가⁻' (보통으로 줄이기)
 *  - 지금 보통  → '가⁺' (크게 키우기)
 */
export function mountDensityToggle(button) {
  const node = typeof button === 'string' ? document.querySelector(button) : button;
  const paint = (density) => {
    if (!node) return;
    const compact = density === 'compact';
    node.textContent = compact ? '가⁺' : '가⁻';
    node.setAttribute('aria-label', compact ? '글자 크게 보기' : '글자 보통 크기로 보기');
    node.setAttribute('aria-pressed', String(compact));
  };

  paint(applyDensity(currentDensity()));

  node?.addEventListener('click', () => {
    paint(applyDensity(currentDensity() === 'compact' ? 'large' : 'compact'));
  });
}

// 화면 깜빡임을 줄이려고 모듈이 로드되는 즉시 한 번 적용한다.
applyDensity(currentDensity());
