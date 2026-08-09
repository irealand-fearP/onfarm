// 농민 판매 등록 흐름 — 사진 → AI 확인 → 판매단위 → 수량 → 등록
import { $, api, money, requireRole, mountModeBanner, toast, el } from '/js/api.js';
import { prepareImage } from '/js/features.js';
import { canListen, listenQuantity, repeatLast, speak } from '/js/speak.js';
import { speakPrice, speakWeight } from '/js/shared/korean.js';

const state = {
  session: null,
  catalog: [],
  analysisId: null,
  imagePath: null,
  analysis: null,
  product: null,
  skus: [],
  sku: null,
  quantity: 5,
  step: 'stepPhoto',
};

const STEPS = ['stepPhoto', 'stepLoading', 'stepResult', 'stepChoose', 'stepManual', 'stepSku', 'stepConfirm', 'stepDone'];
const DOT_INDEX = { stepPhoto: 0, stepLoading: 0, stepResult: 1, stepChoose: 1, stepManual: 1, stepSku: 2, stepConfirm: 3, stepDone: 3 };

function show(step) {
  state.step = step;
  for (const id of STEPS) {
    const node = document.getElementById(id);
    if (node) node.hidden = id !== step;
  }
  const dots = $('#dots').children;
  const active = DOT_INDEX[step] ?? 0;
  for (let i = 0; i < dots.length; i += 1) dots[i].classList.toggle('on', i === active);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function unitWord(label) {
  if (!label) return '개';
  if (label.includes('망')) return '망';
  if (label.includes('봉')) return '봉';
  if (label.includes('상자')) return '상자';
  return '개';
}

function emojiOf(code) {
  return state.catalog.find((p) => p.code === code)?.emoji ?? '🧺';
}
function nameOf(code) {
  return state.catalog.find((p) => p.code === code)?.name ?? code;
}

/* ───────── 시연용 합성 이미지 ─────────
   실제 사진이 없을 때도 파이프라인 전체(특징 추출 → 판정 → SKU)를 그대로 태우기 위한 보조 수단.
   합성 이미지임을 화면에 밝힌다. */
function sampleImageFile() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  // 배경은 실제 촬영 환경(회색 상자/바닥)처럼 채도가 낮게 둔다.
  ctx.fillStyle = '#b9b5ad';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 26; i += 1) {
    const x = 70 + Math.random() * 500;
    const y = 70 + Math.random() * 340;
    const r = 46 + Math.random() * 16;
    // 신고배 표피색(#C7BA7B 근처)에 맞춘다 — 채도가 높으면 실제로 양파에 가까워진다.
    const hue = 48 + Math.random() * 6;
    const grad = ctx.createRadialGradient(x - r / 3, y - r / 3, r / 6, x, y, r);
    grad.addColorStop(0, `hsl(${hue}, 40%, 70%)`);
    grad.addColorStop(1, `hsl(${hue - 4}, 36%, 52%)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], 'sample.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9));
}

/* ───────── 파이프라인 호출 ───────── */
async function analyze(payload) {
  show('stepLoading');
  try {
    const result = await api('/api/ai/analyze', { body: payload });
    state.analysisId = result.analysisId;
    state.imagePath = result.imagePath;
    state.analysis = result;
    state.skus = result.skus ?? [];
    state.sku = result.selectedSku ?? state.skus[0] ?? null;
    state.product = result.recognition.product;
    route(result);
  } catch (err) {
    if (err.status === 410) {
      toast('사진 정보가 만료됐습니다. 다시 찍어 주세요.');
      show('stepPhoto');
      return;
    }
    toast(err.message ?? '분석에 실패했습니다.');
    renderManual();
    show('stepManual');
  }
}

function route(result) {
  const mode = result.decision.mode;
  if (mode === 'auto') {
    renderResult(result);
    show('stepResult');
    speak(`${result.recognition.product_ko}로 확인했습니다.`);
  } else if (mode === 'choose') {
    renderChoose(result);
    show('stepChoose');
    speak(result.decision.headline);
  } else {
    renderManual();
    show('stepManual');
    speak('사진을 자동으로 확인하지 못했습니다. 무엇을 파실까요?');
  }
}

/* ───────── 각 화면 렌더 ───────── */
function renderResult(result) {
  const r = result.recognition;
  $('#resultImage').src = result.imagePath ?? '/img/sample/placeholder.svg';
  $('#resultHeadline').textContent = `${r.product_ko}로 보입니다.`;
  $('#resultSub').textContent = r.variety_guess ? `${r.variety_guess}로 보입니다.` : '';
  $('#badgeSource').textContent = result.ai.offline ? `${result.ai.label} · 사진 외부 전송 없음` : result.ai.label;
  $('#badgeQuality').textContent = `AI 품질 참고: ${r.quality_hint}`;
  $('#badgeConfidence').textContent = `신뢰도 ${Math.round(r.confidence * 100)}%`;
  const basis = [...r.description_basis];
  if (r.detected_issues.length) basis.push(`확인 어려웠던 점: ${r.detected_issues.join(', ')}`);
  $('#resultBasis').textContent = basis.join(' / ');
}

function renderChoose(result) {
  $('#chooseImage').src = result.imagePath ?? '/img/sample/placeholder.svg';
  $('#chooseHeadline').textContent = result.decision.headline;
  const grid = $('#chooseGrid');
  grid.replaceChildren();
  for (const code of result.decision.options) {
    grid.append(
      el('button', { type: 'button', onclick: () => pickProduct(code) }, [
        el('span', { class: 'emoji', text: emojiOf(code) }),
        nameOf(code),
      ]),
    );
  }
}

function renderManual() {
  const grid = $('#manualGrid');
  grid.replaceChildren();
  for (const p of state.catalog) {
    grid.append(
      el('button', { type: 'button', onclick: () => pickProduct(p.code) }, [
        el('span', { class: 'emoji', text: p.emoji ?? '🧺' }),
        p.name,
      ]),
    );
  }
}

async function pickProduct(code) {
  if (!state.analysisId) {
    toast('사진을 먼저 찍어 주세요.');
    show('stepPhoto');
    return;
  }
  await analyzeForced(code);
}

async function analyzeForced(code) {
  show('stepLoading');
  try {
    const result = await api('/api/ai/analyze', { body: { analysisId: state.analysisId, productCode: code } });
    state.analysis = result;
    state.skus = result.skus ?? [];
    state.sku = result.selectedSku ?? state.skus[0] ?? null;
    state.product = code;
    if (!state.sku) {
      toast('이 품목은 아직 판매 단위가 등록되지 않았습니다.');
      renderManual();
      show('stepManual');
      return;
    }
    renderSku();
    show('stepSku');
    speakSku();
  } catch (err) {
    toast(err.message ?? '처리에 실패했습니다.');
    show('stepPhoto');
  }
}

function renderSku() {
  const name = nameOf(state.product);
  $('#skuTitle').textContent = `${name}로 확인했습니다.`;
  const box = $('#skuOptions');
  box.replaceChildren();
  if (state.skus.length > 1) {
    for (const sku of state.skus) {
      const selected = state.sku?.id === sku.id;
      box.append(
        el(
          'button',
          {
            type: 'button',
            style: selected ? 'border-color:var(--brand); background:var(--brand-tint)' : '',
            onclick: () => {
              state.sku = sku;
              renderSku();
              speakSku();
            },
          },
          [el('span', { class: 'emoji', text: selected ? '✅' : '⬜' }), `${sku.label} · ${money(sku.price)}`],
        ),
      );
    }
  }
  $('#skuUnitLabel').textContent = state.sku ? state.sku.label : '';
  $('#skuPrice').textContent = state.sku ? money(state.sku.price) : '-';
  $('#qtyUnitWord').textContent = unitWord(state.sku?.label);
  $('#qtyValue').textContent = String(state.quantity);
}

function speakSku() {
  if (!state.sku) return;
  const word = unitWord(state.sku.label);
  speak(
    `${nameOf(state.product)}로 확인했습니다. ${speakWeight(state.sku.weight, state.sku.unit)} 한 ${word}에 ${speakPrice(state.sku.price)}입니다. 몇 ${word} 판매하시겠습니까?`,
    { force: true },
  );
}

function setQuantity(next) {
  state.quantity = Math.max(1, Math.min(999, next));
  $('#qtyValue').textContent = String(state.quantity);
}

function renderConfirm() {
  const word = unitWord(state.sku?.label);
  $('#confirmImage').src = state.imagePath ?? '/img/sample/placeholder.svg';
  $('#cfProduct').textContent = nameOf(state.product);
  $('#cfSku').textContent = state.sku?.label ?? '-';
  $('#cfPrice').textContent = money(state.sku?.price ?? 0);
  $('#cfQty').textContent = `${state.quantity}${word}`;
  $('#cfTotal').textContent = money((state.sku?.price ?? 0) * state.quantity);
  $('#cfTitle').textContent = state.analysis?.draft?.title ?? '';
  $('#cfDescription').textContent = state.analysis?.draft?.description ?? '';
}

/* ───────── 이벤트 배선 ───────── */
async function onFile(file) {
  if (!file) return;
  show('stepLoading');
  try {
    const prepared = await prepareImage(file);
    $('#loadingPreview').src = prepared.dataUrl;
    $('#loadingPreview').hidden = false;
    await analyze({ image: prepared.dataUrl, features: prepared.features });
  } catch (err) {
    toast(err.message ?? '사진을 읽지 못했습니다.');
    show('stepPhoto');
  }
}

$('#photoInput').addEventListener('change', (e) => onFile(e.target.files?.[0]));
$('#sampleBtn').addEventListener('click', async () => {
  toast('시연용 합성 이미지로 진행합니다(실제 사진 아님).');
  onFile(await sampleImageFile());
});

$('#speakResult').addEventListener('click', () => repeatLast());
$('#speakSku').addEventListener('click', () => speakSku());

$('#resultYes').addEventListener('click', () => {
  if (!state.sku) {
    renderManual();
    show('stepManual');
    return;
  }
  renderSku();
  show('stepSku');
  speakSku();
});
$('#resultNo').addEventListener('click', () => {
  renderManual();
  show('stepManual');
  speak('무엇을 파실까요?');
});
$('#chooseOther').addEventListener('click', () => {
  renderManual();
  show('stepManual');
});
$('#chooseRetake').addEventListener('click', () => show('stepPhoto'));
$('#manualRetake').addEventListener('click', () => show('stepPhoto'));

$('#qtyMinus').addEventListener('click', () => setQuantity(state.quantity - 1));
$('#qtyPlus').addEventListener('click', () => setQuantity(state.quantity + 1));

$('#voiceQty').addEventListener('click', async () => {
  const btn = $('#voiceQty');
  btn.textContent = '🎤 듣고 있습니다…';
  const { quantity, transcript } = await listenQuantity();
  btn.textContent = '🎤 말로 수량 말하기';
  if (quantity) {
    setQuantity(quantity);
    speak(`${quantity}${unitWord(state.sku?.label)}로 하겠습니다.`, { force: true });
  } else {
    toast(transcript ? `"${transcript}" 를 알아듣지 못했습니다.` : '잘 들리지 않았습니다.');
  }
});

$('#skuNext').addEventListener('click', () => {
  renderConfirm();
  show('stepConfirm');
  speak(`${state.quantity}${unitWord(state.sku?.label)}, 모두 ${speakPrice((state.sku?.price ?? 0) * state.quantity)}입니다. 이대로 올릴까요?`, { force: true });
});
$('#confirmBack').addEventListener('click', () => {
  renderSku();
  show('stepSku');
});

$('#submitBtn').addEventListener('click', async () => {
  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = '등록하는 중…';
  try {
    const res = await api('/api/farmer/listings', {
      body: {
        analysisId: state.analysisId,
        skuId: state.sku?.id,
        quantity: state.quantity,
        productCode: state.product,
      },
    });
    const word = unitWord(state.sku?.label);
    $('#doneSummary').textContent = `${nameOf(state.product)} ${state.sku?.label} ${state.quantity}${word}`;
    if (state.session?.farm) {
      $('#doneHub').textContent = '주문이 모이면 지역 거점에 갖다 놓으면 끝';
    }
    state.lastListingId = res.listing.id;
    show('stepDone');
    speak('판매가 시작됐습니다.', { force: true });
  } catch (err) {
    toast(err.message ?? '등록에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '판매 등록';
  }
});

$('#doneStore').addEventListener('click', () => {
  location.href = state.lastListingId ? `/store/product?id=${state.lastListingId}` : '/';
});
$('#doneAgain').addEventListener('click', () => {
  state.analysisId = null;
  state.imagePath = null;
  state.quantity = 5;
  $('#photoInput').value = '';
  show('stepPhoto');
});
$('#doneHome').addEventListener('click', () => (location.href = '/farmer'));

$('#backBtn').addEventListener('click', () => {
  const backMap = {
    stepResult: 'stepPhoto',
    stepChoose: 'stepPhoto',
    stepManual: 'stepPhoto',
    stepSku: 'stepResult',
    stepConfirm: 'stepSku',
  };
  const target = backMap[state.step];
  if (target) show(target);
  else location.href = '/farmer';
});

/* ───────── 부팅 ───────── */
const cfg = await mountModeBanner('#modeBanner');
state.catalog = cfg?.products ?? [];
state.session = await requireRole('farmer');
if (state.session) {
  $('#whoSub').textContent = state.session.farm?.farm_name ?? '';
}
if (canListen()) $('#voiceQty').hidden = false;
renderManual();
show('stepPhoto');
