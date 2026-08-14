// 판매자 "따라 하기 안내" 모드.
// 기존 화면을 바꾸지 않고 body[data-guide="on"] 속성 하나만 얹는다 — 끄면 현행 화면 그대로다.
// 판정(켜짐 여부·자동 졸업)은 /js/shared/seller-guide-state.js 의 순수 함수가 하고,
// 여기서는 저장소 읽기·쓰기와 DOM 반영만 맡는다(seller-density.js 와 같은 구조).
import {
  GRADUATE_AT,
  GUIDE_KEYS,
  nextSellCount,
  resolveGuideState,
  shouldGraduate,
} from '/js/shared/seller-guide-state.js';
import { GUIDE_STEPS } from '/js/shared/sell-steps.js';

/** 시연 모드에서는 발표 도중 안내가 꺼지면 안 되므로 자동 졸업을 막는다. */
let demoMode = false;

export function setGuideDemoMode(on) {
  demoMode = Boolean(on);
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 사파리 프라이빗 모드 — 저장은 못 해도 이번 화면에는 적용된다 */
  }
}

/** 지금 안내가 켜져 있는가(저장값 해석, 기본 on). */
export function guideOn() {
  return resolveGuideState(read(GUIDE_KEYS.state)) === 'on';
}

/** body 속성 토글 + 저장. 적용된 상태(boolean)를 돌려준다. */
export function applyGuide(on) {
  const next = Boolean(on);
  if (document.body) {
    if (next) document.body.setAttribute('data-guide', 'on');
    else document.body.removeAttribute('data-guide');
  }
  write(GUIDE_KEYS.state, next ? 'on' : 'off');
  return next;
}

/**
 * 홈 전용 토글 버튼.
 * 밀도 토글은 '다음 행동'(가⁺/가⁻)을 쓰지만, 안내는 상태 자체가 정보라 '현재 상태'를 쓴다.
 * 그래서 aria-pressed 가 아니라 role="switch" + aria-checked 가 맞다.
 */
export function mountGuideToggle(button, live) {
  const node = typeof button === 'string' ? document.querySelector(button) : button;
  const liveNode = typeof live === 'string' ? document.querySelector(live) : live;
  if (!node) return;

  node.setAttribute('role', 'switch');
  node.classList.add('guide-toggle');
  if (!node.querySelector('.tx')) {
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.setAttribute('aria-hidden', 'true');
    const tx = document.createElement('span');
    tx.className = 'tx';
    node.replaceChildren(sw, tx);
  }

  const paint = (on) => {
    node.setAttribute('aria-checked', String(on));
    node.classList.toggle('is-on', on);
    node.querySelector('.tx').textContent = on ? '안내 켜짐' : '안내 꺼짐';
  };

  paint(applyGuide(guideOn()));

  node.addEventListener('click', () => {
    const on = applyGuide(!guideOn());
    // 사용자가 직접 만졌으면 이후 자동 졸업은 두 번 다시 적용하지 않는다.
    write(GUIDE_KEYS.manual, '1');
    paint(on);
    // 포커스는 토글에 그대로 둔다(6-5). 바뀐 사실만 한 줄로 알린다.
    if (liveNode) {
      liveNode.textContent = on
        ? '따라 하기 안내를 켰습니다. 지금 할 일은 사진 찍기입니다.'
        : '따라 하기 안내를 껐습니다.';
    }
  });
}

/**
 * 등록 완료 시 호출. 3회째면 다음 홈 진입에서 안내를 자동으로 내린다.
 * 반환값은 이번 호출로 졸업했는지 여부.
 */
export function bumpSellCount() {
  const count = nextSellCount(read(GUIDE_KEYS.count));
  write(GUIDE_KEYS.count, String(count));
  const graduate = shouldGraduate({
    count,
    manual: read(GUIDE_KEYS.manual) === '1',
    guide: resolveGuideState(read(GUIDE_KEYS.state)),
    demoMode,
  });
  if (graduate) {
    applyGuide(false);
    write(GUIDE_KEYS.notice, '1');
  }
  return graduate;
}

/** 졸업 안내 줄을 1회만 보여주기 위한 소비형 조회. */
export function consumeGraduationNotice() {
  const pending = read(GUIDE_KEYS.notice) === '1';
  if (pending) write(GUIDE_KEYS.notice, null);
  return pending;
}

/**
 * 데모 데이터 초기화와 함께 부르는 정리.
 * 등록 횟수·졸업 대기 플래그는 localStorage 라 서버 초기화로는 지워지지 않는다.
 */
export function resetGuideProgress() {
  write(GUIDE_KEYS.count, null);
  write(GUIDE_KEYS.notice, null);
  // 예전 키 이름으로 남은 값도 함께 치운다(시연 기기 재사용 대비).
  write('onfarm.seller.guide.count', null);
}

/**
 * 3단계 인디케이터를 그린다(홈·등록 화면 공용).
 * 라벨은 /js/shared/sell-steps.js 한 곳에서만 온다 — 화면마다 다시 타이핑하지 않는다.
 */
export function renderGuideSteps(container, currentIndex) {
  const node = typeof container === 'string' ? document.querySelector(container) : container;
  if (!node) return;
  const parts = [];
  GUIDE_STEPS.forEach((step, index) => {
    if (index > 0) {
      const link = document.createElement('span');
      link.className = 'gs-link';
      parts.push(link);
    }
    const cell = document.createElement('span');
    cell.className = index === currentIndex ? 'gs is-now' : 'gs';
    const no = document.createElement('i');
    no.textContent = String(step.no);
    const full = document.createElement('span');
    full.className = 'full';
    full.textContent = step.label;
    const short = document.createElement('span');
    short.className = 'short';
    short.textContent = step.short;
    cell.append(no, full, short);
    parts.push(cell);
  });
  node.replaceChildren(...parts);
}

export { GRADUATE_AT };

// 화면 깜빡임을 줄이려고 모듈 로드 즉시 한 번 적용한다(density 와 동일).
applyGuide(guideOn());
