// 공통 fetch 래퍼 + 화면 유틸
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? '요청을 처리하지 못했습니다.', res.status, data?.code);
  }
  return data;
}

export function money(value) {
  return `${Number(value ?? 0).toLocaleString('ko-KR')}원`;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2800);
}

/** 로그인 사용자. 없으면 null */
export async function me() {
  try {
    return await api('/api/me');
  } catch {
    return null;
  }
}

export async function requireRole(role, redirect = '/login') {
  const data = await me();
  if (!data || (data.user.role !== role && data.user.role !== 'admin')) {
    location.href = `${redirect}?next=${encodeURIComponent(location.pathname)}&role=${role}`;
    return null;
  }
  return data;
}

/** AI provider 상태를 읽어 데모/강등 배너를 붙인다. */
export async function mountModeBanner(target) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return null;
  try {
    const cfg = await api('/api/config');
    const messages = [];
    if (cfg.ai.demoMode) messages.push('데모 모드 — AI 응답이 고정값입니다(실제 인식 아님).');
    if (cfg.ai.degradedReason) messages.push(cfg.ai.degradedReason);
    if (!cfg.ai.demoMode && cfg.ai.provider === 'heuristic') {
      messages.push('현재 판정은 외부 전송 없이 기기/서버에서 도는 색·질감 규칙 기반입니다.');
    }
    if (messages.length === 0) {
      node.hidden = true;
    } else {
      node.hidden = false;
      node.textContent = messages.join(' · ');
    }
    return cfg;
  } catch {
    node.hidden = true;
    return null;
  }
}

export const INSPECTION_STEPS = [
  ['ai_checked', 'AI 확인'],
  ['hub_pending', '거점 검수 대기'],
  ['hub_passed', '검수 완료'],
  ['ready_to_ship', '배송 준비'],
  ['delivered', '배송 완료'],
];

export function inspectionLabel(status) {
  return INSPECTION_STEPS.find(([key]) => key === status)?.[1] ?? status;
}

export function imageOf(listing) {
  return listing.image_path || '/img/sample/placeholder.svg';
}

// PWA: 화면 껍데기만 캐시한다(설치형으로 쓰기 위함). 실패해도 앱 동작에는 영향이 없다.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
