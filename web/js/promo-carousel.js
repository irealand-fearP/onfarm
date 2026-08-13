// 홈 상단 산지 추천 배너 캐러셀 — 외부 라이브러리 없이 transform 이동만으로 굴린다.
// 자동 순환은 "사용자가 보고 있는 중"(hover·포커스·터치)에는 멈춘다. 읽는 도중에 화면이 바뀌면 안 되기 때문이다.

const INTERVAL_MS = 4000;
const SWIPE_THRESHOLD_PX = 40; // 이보다 적게 밀면 넘기지 않는다(세로 스크롤 오인식 방지).

export function mountPromoCarousel(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return;

  const track = root.querySelector('.promo-track');
  const dotsBox = root.querySelector('.promo-dots');
  const slides = [...root.querySelectorAll('.promo-slide')];
  if (!track || !dotsBox || slides.length === 0) return;

  // 움직임 최소화 설정이면 자동 순환을 하지 않는다(점으로 직접 이동만 가능).
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let index = 0;
  let timer = null;
  // 멈춤 이유가 여러 개(hover·포커스·터치) 겹칠 수 있어 집합으로 센다.
  const pauseReasons = new Set();

  const dots = slides.map((_, position) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'promo-dot';
    dot.setAttribute('aria-label', `${position + 1}번째 배너로 이동`);
    dot.addEventListener('click', () => {
      goTo(position);
      restart();
    });
    dotsBox.append(dot);
    return dot;
  });

  function goTo(next) {
    index = (next + slides.length) % slides.length;
    track.style.transform = `translateX(${-index * 100}%)`;
    slides.forEach((slide, position) => {
      // 화면 밖 슬라이드는 키보드 탭 순서에서 빼 "보이지 않는 링크"에 포커스가 가지 않게 한다.
      slide.toggleAttribute('inert', position !== index);
    });
    dots.forEach((dot, position) => dot.setAttribute('aria-current', String(position === index)));
  }

  function start() {
    if (timer || reduceMotion.matches || pauseReasons.size > 0) return;
    timer = window.setInterval(() => goTo(index + 1), INTERVAL_MS);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function restart() {
    stop();
    start();
  }

  function pause(reason) {
    pauseReasons.add(reason);
    stop();
  }

  function resume(reason) {
    pauseReasons.delete(reason);
    start();
  }

  root.addEventListener('mouseenter', () => pause('hover'));
  root.addEventListener('mouseleave', () => resume('hover'));
  // 키보드로 들어온 포커스일 때만 멈춘다(마우스 클릭 뒤 남는 포커스로 계속 멈춰 있지 않게).
  root.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible')) pause('focus');
  });
  root.addEventListener('focusout', () => resume('focus'));

  // 스와이프 — 터치 시작~끝의 가로 이동량만 보고 한 장씩 넘긴다.
  let touchStartX = 0;
  let touchStartY = 0;

  root.addEventListener(
    'touchstart',
    (event) => {
      pause('touch');
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true },
  );

  root.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0];
      const moveX = touch.clientX - touchStartX;
      const moveY = touch.clientY - touchStartY;
      // 세로로 더 많이 움직였으면 스크롤 의도로 보고 무시한다.
      if (Math.abs(moveX) > SWIPE_THRESHOLD_PX && Math.abs(moveX) > Math.abs(moveY)) {
        goTo(moveX < 0 ? index + 1 : index - 1);
      }
      resume('touch');
    },
    { passive: true },
  );

  root.addEventListener('touchcancel', () => resume('touch'), { passive: true });

  // 설정을 도중에 바꿔도 즉시 반영한다.
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? stop() : start()));

  goTo(0);
  start();
}
