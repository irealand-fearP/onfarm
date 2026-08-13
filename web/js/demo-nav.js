// 시연 이동 메뉴 — 판매자·소비자·거점 모든 화면(하위 페이지 포함)이 공유한다.
// 지금까지는 역할을 바꾸려면 주소를 직접 고쳐 쳐야 해서 발표 중 흐름이 끊겼다.
// 어르신용 주 동선이 아니라 발표자용 보조 수단이므로 작게, 눈에 띄지 않게 둔다.
//
// 이동을 "링크"가 아니라 "그 역할로 로그인한 뒤 이동"으로 만든 이유:
// 소비자 세션으로 /seller 를 열면 requireRole 이 로그인 화면으로 튕겨 시연이 막혔다.
// 세션 역할과 목적지가 어긋나는 경우를 메뉴가 스스로 없앤다.
import { api, el, toast } from '/js/api.js';

/** 시연 목적지. role 이 있으면 그 역할 계정으로 먼저 로그인한다. */
const TARGETS = [
  { key: 'seller', href: '/seller', label: '판매자', role: 'farmer', name: '김복순' },
  { key: 'shop', href: '/shop', label: '소비자', role: 'consumer', name: '장바구니' },
  { key: 'hub', href: '/hub', label: '거점', role: 'hub_operator' },
  { key: 'demo', href: '/demo', label: '시연 시작' },
];

const CART_KEY = 'onfarm.cart.v1';

/** 지금 어느 화면인지. 소비자 홈은 '/' 로도 열리므로 그것도 shop 으로 본다. */
function currentSite(pathname = location.pathname) {
  if (pathname === '/' || pathname.startsWith('/shop') || pathname.startsWith('/store')) return 'shop';
  for (const { key } of TARGETS) {
    if (pathname.startsWith(`/${key}`)) return key;
  }
  return '';
}

/** 계정 목록은 한 화면에서 여러 번 부르지 않는다. */
let accountsPromise = null;
function loadAccounts() {
  accountsPromise ??= api('/api/accounts').then((data) => data.accounts ?? []);
  return accountsPromise;
}

/**
 * 이 담당자가 그 거점 사람인가.
 * 시드 담당자 이름은 '<지역>거점 담당자' 이고 거점 이름에 그 지역이 들어 있다
 * (예: '포항거점 담당자' ↔ '포항 구룡포 수산 거점').
 * /api/accounts 응답에 거점 정보를 더하면 API 형식이 바뀌므로, 시연 한정으로
 * 이름의 지역 낱말을 맞춰 본다. 못 찾으면 그냥 첫 담당자로 떨어진다.
 */
function worksAtHub(operatorName, hubName) {
  const keyword = String(operatorName).replace(/거점\s*담당자$/, '').trim();
  return keyword.length > 1 && String(hubName).includes(keyword);
}

/**
 * 시연 목적지로 이동한다. 역할이 정해진 목적지는 그 역할 계정으로 먼저 로그인한다.
 * 이름이 지정된 계정을 우선 찾고, 없으면 같은 역할의 아무 계정이나 쓴다.
 * @param {string} key TARGETS 의 key
 * @param {{to?: string, name?: string, hubName?: string}} [options]
 *   to      이동할 주소(생략하면 목적지 기본 주소)
 *   name    로그인할 계정 이름. 특정 주문의 생산자처럼 "이 사람이어야 하는" 경우에 쓴다.
 *           (기본 농민으로 가면 그 주문이 안 보여서 또 막힌다)
 *   hubName 그 주문을 맡은 거점 이름. 거점 담당자는 자기 거점 물량만 보므로
 *           엉뚱한 담당자로 가면 화면이 비어 또 막힌다.
 */
export async function goToDemoTarget(key, options = {}) {
  const target = TARGETS.find((item) => item.key === key);
  if (!target) return;
  const href = options.to ?? target.href;

  if (!target.role) {
    location.href = href;
    return;
  }

  const wanted = options.name ?? target.name;
  try {
    const accounts = await loadAccounts();
    const sameRole = accounts.filter((row) => row.role === target.role);
    const account =
      (options.hubName ? sameRole.find((row) => worksAtHub(row.name, options.hubName)) : null) ??
      sameRole.find((row) => !wanted || row.name === wanted) ??
      sameRole[0];
    if (!account) {
      toast('시연 계정을 찾지 못했습니다. 데이터 초기화를 먼저 해주세요.');
      return;
    }
    await api('/api/auth/login', { body: { userId: account.id } });
  } catch (error) {
    // 로그인에 실패해도 이동은 시켜준다. 메뉴가 막다른 길이 되면 안 된다.
    toast(error?.message ?? '역할을 바꾸지 못했습니다. 그대로 이동합니다.');
  }
  location.href = href;
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

  // ── 데이터 초기화 ─────────────────────────────────────────
  // 되돌릴 수 없으므로 한 번에 실행하지 않고 확인 단계를 하나 둔다.
  // 브라우저 confirm() 대신 패널 안에서 묻는다(임베드·iOS 에서 confirm 이 막히는 경우가 있다).
  const resetError = el('p', { class: 'demo-nav-error', role: 'alert', hidden: '' });

  const resetButton = el('button', {
    class: 'demo-nav-reset',
    type: 'button',
    text: '데이터 초기화',
    onclick: () => setConfirmOpen(true),
  });

  const confirmYes = el('button', { class: 'demo-nav-danger', type: 'button', text: '지웁니다' });
  const confirmNo = el('button', {
    class: 'demo-nav-cancel',
    type: 'button',
    text: '취소',
    onclick: () => {
      setConfirmOpen(false);
      resetButton.focus();
    },
  });

  const confirmBox = el('div', { class: 'demo-nav-confirm', hidden: '' }, [
    el('p', { text: '올린 상품과 주문을 모두 지우고 처음 상태로 되돌립니다. 되돌릴 수 없습니다.' }),
    el('div', { class: 'demo-nav-confirm-actions' }, [confirmNo, confirmYes]),
  ]);

  function setConfirmOpen(open) {
    confirmBox.hidden = !open;
    resetButton.hidden = open;
    if (open) {
      resetError.hidden = true;
      confirmYes.focus();
    }
  }

  confirmYes.addEventListener('click', async () => {
    confirmYes.disabled = true;
    confirmYes.textContent = '지우는 중…';
    resetError.hidden = true;
    try {
      const result = await api('/api/demo/reset', { body: { confirm: 'RESET' } });
      // 초기화하면 계정이 다시 만들어져 지금 세션은 무효가 된다.
      // 그래서 세션이 필요 없는 시연 시작 화면으로 보낸다(다시 역할을 고르는 자리).
      try {
        localStorage.removeItem(CART_KEY);
      } catch {
        /* 저장소를 못 써도 서버 데이터는 이미 초기화됐다 */
      }
      toast(result?.message ?? '처음 상태로 되돌렸습니다. 시연 시작 화면으로 갑니다.');
      setTimeout(() => {
        location.href = '/demo?reset=1';
      }, 900);
    } catch (error) {
      // 조용히 실패하지 않는다 — 왜 안 됐는지 화면에 남긴다.
      const reason = error?.message ?? '알 수 없는 오류';
      resetError.textContent =
        error?.status === 403
          ? `초기화하지 못했습니다 · ${reason} (DEMO_RESET_ENABLED 를 확인하세요)`
          : `초기화하지 못했습니다 · ${reason}`;
      resetError.hidden = false;
      confirmYes.disabled = false;
      confirmYes.textContent = '지웁니다';
    }
  });

  // ── 팝오버 ────────────────────────────────────────────────
  const panel = el('div', { class: 'demo-nav-panel', id: panelId, role: 'group', 'aria-label': '시연 화면 이동', hidden: '' }, [
    el('p', { class: 'demo-nav-title', text: '시연 화면 이동' }),
    ...TARGETS.map((item) =>
      item.key === here
        ? // 지금 보고 있는 화면은 눌러도 의미가 없으므로 링크가 아니라 현재 위치 표시로 둔다.
          el('span', { class: 'demo-nav-item is-here', 'aria-current': 'page' }, [
            el('span', { text: item.label }),
            el('em', { text: '지금 이 화면' }),
          ])
        : // href 를 함께 둬서 새 탭 열기·주소 확인 같은 링크의 성질을 잃지 않게 한다.
          el('a', {
            class: 'demo-nav-item',
            href: item.href,
            onclick: (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              void goToDemoTarget(item.key);
            },
          }, [el('span', { text: item.label })]),
    ),
    el('div', { class: 'demo-nav-sep' }, [resetButton, confirmBox, resetError]),
    el('button', { class: 'demo-nav-close', type: 'button', text: '닫기' }),
  ]);

  const wrap = el('div', { class: 'demo-nav' }, [button, panel]);
  host.append(wrap);

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) setConfirmOpen(false);
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
