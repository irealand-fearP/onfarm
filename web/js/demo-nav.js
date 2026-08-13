// 시연 이동 메뉴 — 판매자·소비자·거점 세 화면이 공유한다.
// 지금까지는 역할을 바꾸려면 주소를 직접 고쳐 쳐야 해서 발표 중 흐름이 끊겼다.
// 어르신용 주 동선이 아니라 발표자용 보조 수단이므로 작게, 눈에 띄지 않게 둔다.
import { el } from '/js/api.js';

const TARGETS = [
  ['seller', '/seller', '판매자'],
  ['shop', '/shop', '소비자'],
  ['hub', '/hub', '거점'],
  ['demo', '/demo', '시연 시작'],
];

/** 지금 어느 화면인지. 소비자 홈은 '/' 로도 열리므로 그것도 shop 으로 본다. */
function currentSite(pathname = location.pathname) {
  if (pathname === '/' || pathname.startsWith('/shop') || pathname.startsWith('/store')) return 'shop';
  for (const [key] of TARGETS) {
    if (pathname.startsWith(`/${key}`)) return key;
  }
  return '';
}

/**
 * 헤더에 "시연" 버튼과 팝오버를 붙인다.
 * @param {string|Element} target 버튼을 넣을 컨테이너(선택자 또는 요소)
 */
export function mountDemoNav(target) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) return;

  const here = currentSite();
  const panelId = 'demoNavPanel';

  const button = el('button', {
    class: 'demo-nav-btn',
    type: 'button',
    'aria-expanded': 'false',
    'aria-haspopup': 'true',
    'aria-controls': panelId,
    text: '시연',
  });

  const panel = el('div', { class: 'demo-nav-panel', id: panelId, role: 'group', 'aria-label': '시연 화면 이동', hidden: '' }, [
    el('p', { class: 'demo-nav-title', text: '시연 화면 이동' }),
    ...TARGETS.map(([key, href, label]) =>
      key === here
        ? // 지금 보고 있는 화면은 눌러도 의미가 없으므로 링크가 아니라 현재 위치 표시로 둔다.
          el('span', { class: 'demo-nav-item is-here', 'aria-current': 'page' }, [
            el('span', { text: label }),
            el('em', { text: '지금 이 화면' }),
          ])
        : el('a', { class: 'demo-nav-item', href }, [el('span', { text: label })]),
    ),
    el('button', { class: 'demo-nav-close', type: 'button', text: '닫기' }),
  ]);

  const wrap = el('div', { class: 'demo-nav' }, [button, panel]);
  host.append(wrap);

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  button.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('.demo-nav-close').addEventListener('click', () => {
    setOpen(false);
    button.focus();
  });

  // Esc 와 바깥 클릭으로도 닫는다(열어 두고 빠져나갈 방법이 항상 있어야 한다).
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    setOpen(false);
    button.focus();
  });
  document.addEventListener('click', (event) => {
    if (panel.hidden || wrap.contains(event.target)) return;
    setOpen(false);
  });
}
