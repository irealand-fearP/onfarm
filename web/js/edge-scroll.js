// 가로로 넘치는 줄(품목 칩·종류 탭)을 마우스만 있는 데스크톱에서도 끝까지 볼 수 있게 한다.
// 스크롤바를 감춘 상태라 터치가 없는 환경에서는 밀 방법이 없었다. 세 가지를 함께 붙인다.
//   ① 휠(세로 굴림)을 가로 스크롤로 바꿔 준다
//   ② 마우스 환경에서만 좌우 화살표 버튼을 띄운다
//   ③ 양 끝 페이드로 "더 있다"를 눈으로 알린다(스크롤 위치에 따라 켜고 끈다)

const SCROLL_RATIO = 0.7; // 화살표 한 번에 화면 폭의 70%씩 이동(맥락이 끊기지 않게 일부는 남긴다)
const EDGE_SLACK_PX = 2; // 소수점 오차로 "끝인데 끝이 아님"이 되는 것을 막는 여유

/** [data-hscroll] 로 표시한 상자마다 화살표·페이드를 달아 준다. */
export function mountEdgeScrollers(selector = '[data-hscroll]') {
  for (const box of document.querySelectorAll(selector)) setup(box);
}

function setup(box) {
  // 스크롤되는 실제 요소는 상자의 첫 자식(예: .item-strip)이다.
  const scroller = box.firstElementChild;
  if (!scroller) return;

  const prev = arrowButton('prev', '왼쪽으로 이동');
  const next = arrowButton('next', '오른쪽으로 이동');
  box.append(prev, next);

  prev.addEventListener('click', () => scrollBy(-1));
  next.addEventListener('click', () => scrollBy(1));

  function scrollBy(direction) {
    scroller.scrollBy({ left: direction * scroller.clientWidth * SCROLL_RATIO, behavior: 'smooth' });
  }

  // 휠 — 세로 굴림만 가로로 돌린다. 가로 휠(트랙패드)은 브라우저 기본 동작에 맡긴다.
  scroller.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (!canScroll()) return;
      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    },
    { passive: false },
  );

  function canScroll() {
    return scroller.scrollWidth - scroller.clientWidth > EDGE_SLACK_PX;
  }

  function update() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const atStart = scroller.scrollLeft <= EDGE_SLACK_PX;
    const atEnd = scroller.scrollLeft >= max - EDGE_SLACK_PX;
    // 넘치지 않으면 화살표·페이드를 모두 숨긴다(움직일 곳이 없는데 신호를 주지 않는다).
    box.toggleAttribute('data-can-prev', canScroll() && !atStart);
    box.toggleAttribute('data-can-next', canScroll() && !atEnd);
    prev.hidden = !canScroll() || atStart;
    next.hidden = !canScroll() || atEnd;
  }

  scroller.addEventListener('scroll', update, { passive: true });
  // 칩 목록은 필터에 따라 다시 그려지므로 내용 변화도 감시해야 한다.
  new MutationObserver(update).observe(scroller, { childList: true });
  new ResizeObserver(update).observe(scroller);
  update();
}

function arrowButton(kind, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `hscroll-arrow hscroll-arrow--${kind}`;
  button.setAttribute('aria-label', label);
  button.hidden = true;
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return button;
}
