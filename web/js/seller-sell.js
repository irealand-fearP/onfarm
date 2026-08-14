// 판매자 등록 흐름 — 사진 → 품목 → 수량(최종 확인 포함) → 완료.
// 서버 계약(POST /api/ai/analyze, POST /api/farmer/listings)은 그대로 두고 화면만 재구성했다.
// 기존 farmer-sell.js 의 로직(파이프라인 호출·TTS 낭독·STT 수량 입력)을 그대로 옮겨 쓴다.
import { $, api, money, requireRole, mountModeBanner, toast, el } from '/js/api.js';
import { prepareImage } from '/js/features.js';
import { canListen, explainListenResult, listenQuantity, repeatLast, speak } from '/js/speak.js';
import { speakPrice, speakWeight, sinoNumber, nativeCount } from '/js/shared/korean.js';
import { mountDensityToggle } from '/js/seller-density.js';
import { mountDemoNav } from '/js/demo-nav.js';

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
  /** 사용자가 폴백 화면에서 품목을 직접 골랐는가 (감사 기록용) */
  userPicked: false,
  /** "사진 없이 시연" 경로로 만든 사진인가 (파일명 표식 → 소비자 화면 배지) */
  demoPhoto: false,
};

const STEPS = ['stepPhoto', 'stepLoading', 'stepResult', 'stepManual', 'stepSku', 'stepDone'];

// 실제 단계는 사진·품목·수량 셋이다. 표기를 여기에 맞춘다(예전 1/4 표기 불일치 수정).
const STEP_PROGRESS = {
  stepPhoto: { step: '1 / 3', label: '사진 찍기', hint: '한 장이면 됩니다', value: 33 },
  stepLoading: { step: '1 / 3', label: '사진 확인 중', hint: '잠시만요', value: 33 },
  stepResult: { step: '2 / 3', label: '품목 고르기', hint: '거의 다 됐어요', value: 66 },
  stepManual: { step: '2 / 3', label: '품목 고르기', hint: '거의 다 됐어요', value: 66 },
  stepSku: { step: '3 / 3', label: '수량 확인', hint: '마지막이에요', value: 100 },
  stepDone: { step: '완료', label: '판매 등록 완료', hint: '', value: 100 },
};

function show(step) {
  state.step = step;
  for (const id of STEPS) {
    const node = document.getElementById(id);
    if (node) node.hidden = id !== step;
  }
  const progress = STEP_PROGRESS[step];
  const progressNode = $('#sellProgress');
  progressNode.hidden = step === 'stepDone';
  progressNode.setAttribute('aria-valuenow', String(progress.value));
  $('#progressStep').textContent = progress.step;
  $('#progressLabel').textContent = progress.label;
  $('#progressHint').textContent = progress.hint;
  $('#progressFill').style.width = `${progress.value}%`;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function unitWord(label) {
  if (!label) return '개';
  if (label.includes('망')) return '망';
  if (label.includes('봉')) return '봉';
  if (label.includes('상자')) return '상자';
  return '개';
}

function nameOf(code) {
  return state.catalog.find((p) => p.code === code)?.name ?? code;
}

/* ───────── 시연용 사진 ─────────
   실제 사진이 없을 때도 파이프라인 전체(특징 추출 → 판정 → SKU)를 그대로 태우기 위한 보조 수단.
   합성 이미지는 결과물이 가짜 얼룩으로 보여서, 준비된 실사 상품컷(배)을 그대로 쓴다.
   시연 대본이 배 기준이라 품목은 배로 고정한다. */
const SAMPLE_IMAGE_URL = '/img/products/pear.webp';

async function sampleImageFile() {
  const res = await fetch(SAMPLE_IMAGE_URL, { cache: 'force-cache' });
  if (!res.ok) throw new Error('시연용 사진을 불러오지 못했습니다.');
  const blob = await res.blob();
  // prepareImage 가 어차피 JPEG 로 다시 인코딩하므로 webp 그대로 넘겨도 된다.
  return new File([blob], 'demo-pear.webp', { type: blob.type || 'image/webp' });
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
  // 신뢰도와 무관하게 후보를 번호로 보여준다.
  // 후보가 하나여도 사용자가 직접 고르게 하는 이 한 번이 오등록을 막는 안전장치다.
  const candidates = result.candidates ?? [];
  if (candidates.length === 0) {
    renderManual();
    show('stepManual');
    speak('사진을 자동으로 확인하지 못했습니다. 무엇을 파실까요?');
    return;
  }
  renderResult(result);
  show('stepResult');
  speakCandidates(candidates);
}

/**
 * 후보를 번호와 함께 읽어준다. 화면을 못 보는 상황에서도 고를 수 있게.
 * 숫자를 그대로 넣으면 TTS 가 "1번"을 '한 번(once)'으로 읽어 횟수처럼 들린다.
 * 그래서 번호는 한자어 수사로 풀어 "일번, 이번, 삼번" 이라고 말하게 한다.
 */
function speakCandidates(candidates) {
  const list = candidates.map((c, i) => `${sinoNumber(i + 1)}번 ${c.name}`).join(', ');
  speak(`사진을 확인했습니다. ${list} 중에 어느 것인가요?`, { force: true });
}

/* ───────── 각 화면 렌더 ───────── */
function renderResult(result) {
  const r = result.recognition;
  const candidates = result.candidates ?? [];
  $('#resultSub').textContent =
    candidates.length > 1 ? '가장 비슷한 것부터 보여드립니다.' : '사진과 같으면 눌러 주세요.';

  const grid = $('#candidateGrid');
  grid.replaceChildren();
  candidates.forEach((c, i) => {
    const first = i === 0;
    grid.append(
      el(
        'button',
        {
          type: 'button',
          class: `cand${first ? ' on' : ''}`,
          'aria-label': `${i + 1}번 ${c.name}${first ? ', 가장 비슷한 품목' : ''}`,
          onclick: () => pickProduct(c.code),
        },
        [
          el('span', { class: 'no', text: `${i + 1}` }),
          el('span', {}, [
            el('span', { class: 'nm', text: c.name }),
            el('span', { class: 'cf', text: first ? '가장 비슷해요' : '비슷할 수 있어요' }),
          ]),
        ],
      ),
    );
  });

  $('#badgeSource').textContent = result.ai.offline
    ? `${result.ai.label} · 사진 외부 전송 없음`
    : result.ai.label;
  $('#badgeQuality').textContent = `AI 품질 참고: ${r.quality_hint}`;
  $('#badgeConfidence').textContent = r.confidence
    ? `1순위 신뢰도 ${Math.round(r.confidence * 100)}%`
    : '';
  const basis = [...r.description_basis];
  if (r.detected_issues.length) basis.push(`확인 어려웠던 점: ${r.detected_issues.join(', ')}`);
  if (result.ai.degraded) basis.push(`※ ${result.ai.degraded}`);
  $('#resultBasis').textContent = basis.join(' / ');
}

function renderManual() {
  const grid = $('#manualGrid');
  grid.replaceChildren();
  for (const p of state.catalog) {
    grid.append(
      el('button', { type: 'button', class: 'cand', onclick: () => pickProduct(p.code) }, [
        el('span', { class: 'nm', text: p.name }),
      ]),
    );
  }
}

async function pickProduct(code) {
  // 분석 요청 자체가 실패해 analysisId 가 없을 수 있다.
  // 그때도 사진은 손에 있으므로 사진과 함께 다시 보내 폴백이 막다른 길이 되지 않게 한다.
  if (!state.analysisId && !state.pendingImage) {
    toast('사진을 먼저 찍어 주세요.');
    show('stepPhoto');
    return;
  }
  await analyzeForced(code);
}

async function analyzeForced(code) {
  show('stepLoading');
  try {
    const payload = state.analysisId
      ? { analysisId: state.analysisId, productCode: code }
      : {
          image: state.pendingImage.dataUrl,
          features: state.pendingImage.features,
          pixels: state.pendingImage.pixels,
          productCode: code,
          demo: state.demoPhoto,
        };
    const result = await api('/api/ai/analyze', { body: payload });
    if (result.analysisId) state.analysisId = result.analysisId;
    if (result.imagePath) state.imagePath = result.imagePath;
    state.analysis = result;
    state.skus = result.skus ?? [];
    state.sku = result.selectedSku ?? state.skus[0] ?? null;
    state.product = code;
    state.userPicked = true;
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

/** 수량 화면 = 예전 stepSku + stepConfirm. 상단 요약·중앙 스테퍼·하단 합계를 한 번에 그린다. */
function renderSku() {
  const farm = state.session?.farm;
  $('#skuFarm').textContent = farm ? `${farm.farm_name} · ${farm.region_sigungu}` : '';
  $('#skuLine').textContent = state.sku
    ? `${nameOf(state.product)} · ${state.sku.label} · ${money(state.sku.price)}`
    : nameOf(state.product);

  const box = $('#skuOptions');
  box.replaceChildren();
  box.hidden = state.skus.length <= 1;
  if (state.skus.length > 1) {
    for (const sku of state.skus) {
      const selected = state.sku?.id === sku.id;
      box.append(
        el(
          'button',
          {
            type: 'button',
            class: `cand${selected ? ' on' : ''}`,
            'aria-pressed': String(selected),
            onclick: () => {
              state.sku = sku;
              renderSku();
              speakSku();
            },
          },
          [
            el('span', {}, [
              el('span', { class: 'nm', text: sku.label }),
              el('span', { class: 'cf', text: money(sku.price) }),
            ]),
          ],
        ),
      );
    }
  }

  $('#qtyUnitWord').textContent = unitWord(state.sku?.label);
  $('#qtyValue').textContent = String(state.quantity);
  renderQuantityVisual();
}

function renderQuantityVisual() {
  const word = unitWord(state.sku?.label);
  const visibleCount = Math.min(state.quantity, 5);
  const pack = $('#quantityPack');
  pack.replaceChildren();
  for (let i = 0; i < visibleCount; i += 1) pack.append(el('i', {}));
  if (state.quantity > visibleCount) {
    pack.append(el('span', { class: 'more', text: `+${state.quantity - visibleCount}` }));
  }
  pack.setAttribute('aria-label', `선택한 수량: ${state.quantity}${word}`);
  $('#sumTotal').textContent = money((state.sku?.price ?? 0) * state.quantity);
}

function speakSku() {
  if (!state.sku) return;
  const word = unitWord(state.sku.label);
  speak(
    `${nameOf(state.product)}로 확인했습니다. ${speakWeight(state.sku.weight, state.sku.unit)} 한 ${word}에 ${speakPrice(state.sku.price)}입니다. 몇 ${word} 판매하시겠습니까?`,
    { force: true },
  );
}

/** 합계 낭독 — 수량을 바꾼 뒤 잠깐 멈추면 읽어준다(버튼을 연타할 때 말이 겹치지 않게 지연). */
let totalSpeakTimer = null;
function speakTotalSoon() {
  clearTimeout(totalSpeakTimer);
  totalSpeakTimer = setTimeout(() => {
    if (!state.sku) return;
    speak(
      `${nativeCount(state.quantity)} ${unitWord(state.sku.label)}, 모두 ${speakPrice(state.sku.price * state.quantity)}입니다.`,
      { force: true },
    );
  }, 900);
}

function setQuantity(next) {
  state.quantity = Math.max(1, Math.min(999, next));
  $('#qtyValue').textContent = String(state.quantity);
  renderQuantityVisual();
  speakTotalSoon();
}

/* ───────── 이벤트 배선 ───────── */
async function onFile(file, options = {}) {
  if (!file) return;
  // 시연용 경로로 들어온 사진은 서버가 파일명에 표식을 남기도록 알린다.
  state.demoPhoto = options.demo === true;
  show('stepLoading');
  try {
    const prepared = await prepareImage(file);
    // 분석이 실패해도 폴백 화면에서 다시 쓸 수 있도록 들고 있는다.
    state.pendingImage = prepared;
    state.analysisId = null;
    state.userPicked = false;
    $('#loadingPreview').src = prepared.dataUrl;
    $('#loadingPreview').hidden = false;
    await analyze({
      image: prepared.dataUrl,
      features: prepared.features,
      pixels: prepared.pixels,
      demo: state.demoPhoto,
    });
  } catch (err) {
    toast(err.message ?? '사진을 읽지 못했습니다.');
    show('stepPhoto');
  }
}

$('#photoInput').addEventListener('change', (e) => onFile(e.target.files?.[0]));
$('#sampleBtn').addEventListener('click', async () => {
  toast('시연용 사진으로 진행합니다(농민이 찍은 실제 사진 아님).');
  try {
    onFile(await sampleImageFile(), { demo: true });
  } catch (err) {
    toast(err.message ?? '시연용 사진을 불러오지 못했습니다.');
  }
});

$('#speakResult').addEventListener('click', () => repeatLast());
$('#speakSku').addEventListener('click', () => speakSku());

$('#resultNo').addEventListener('click', () => {
  renderManual();
  show('stepManual');
  speak('무엇을 파실까요?');
});
$('#resultRetake').addEventListener('click', () => show('stepPhoto'));
$('#manualRetake').addEventListener('click', () => show('stepPhoto'));

$('#qtyMinus').addEventListener('click', () => setQuantity(state.quantity - 1));
$('#qtyPlus').addEventListener('click', () => setQuantity(state.quantity + 1));

/** 음성이 아예 안 되는 상황 — 마이크 버튼을 접고 + − 버튼 안내를 남긴다. */
function showManualQtyHint() {
  const btn = $('#voiceQty');
  if (btn) btn.hidden = true;
  const hint = $('#qtyManualHint');
  if (hint) hint.hidden = false;
}

$('#voiceQty').addEventListener('click', async () => {
  const btn = $('#voiceQty');
  const label = $('#voiceQtyLabel');
  btn.disabled = true;
  btn.classList.add('is-listening');
  label.textContent = '듣고 있습니다';
  try {
    // 실패 원인(권한 거부·못 들음·해석 실패)에 따라 안내를 다르게 한다.
    const feedback = explainListenResult(await listenQuantity());
    if (feedback.ok) {
      setQuantity(feedback.quantity);
      speak(`${nativeCount(feedback.quantity)} ${unitWord(state.sku?.label)}로 하겠습니다.`, { force: true });
    } else {
      toast(feedback.message);
      speak(feedback.message, { force: true });
      if (feedback.showManualFallback) showManualQtyHint();
    }
  } catch (err) {
    console.warn('[음성수량] 예외', err);
    toast('음성을 듣지 못했습니다. 버튼으로 수량을 골라 주세요.');
    showManualQtyHint();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-listening');
    label.textContent = '“세 상자”라고 말해도 됩니다';
  }
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
        // 서버가 인식한 품목을 그대로 쓰는 정상 흐름에서는 보내지 않는다.
        // (항상 보내면 서버 감사 기록이 전부 '수동 선택'으로 남는다)
        ...(state.userPicked ? { productCode: state.product } : {}),
      },
    });
    const word = unitWord(state.sku?.label);
    $('#doneSummary').textContent = `${nameOf(state.product)} ${state.quantity}${word}를 지금부터 팝니다`;
    $('#doneTotal').textContent = money((state.sku?.price ?? 0) * state.quantity);
    state.lastListingId = res.listing.id;
    show('stepDone');
    speak('판매가 시작됐습니다.', { force: true });
  } catch (err) {
    toast(err.message ?? '등록에 실패했습니다.');
  } finally {
    btn.disabled = false;
    btn.textContent = '이대로 팔기';
  }
});

$('#doneAgain').addEventListener('click', () => {
  state.analysisId = null;
  state.imagePath = null;
  state.pendingImage = null;
  state.demoPhoto = false;
  state.quantity = 5;
  $('#photoInput').value = '';
  $('#loadingPreview').hidden = true;
  show('stepPhoto');
});
$('#doneStop').addEventListener('click', () => (location.href = '/seller'));

$('#backBtn').addEventListener('click', () => {
  const backMap = {
    stepResult: 'stepPhoto',
    stepManual: 'stepResult',
    stepSku: 'stepResult',
  };
  const target = backMap[state.step];
  if (target) show(target);
  else location.href = '/seller';
});

/* ───────── 부팅 ───────── */
mountDensityToggle('#densityBtn');
mountDemoNav('#demoNavSlot');
const cfg = await mountModeBanner('#modeBanner');
state.catalog = cfg?.products ?? [];
state.session = await requireRole('farmer');
// 음성 인식은 Chrome·Edge + HTTPS 에서만 된다. 안 되면 버튼 안내를 대신 띄운다.
if (canListen()) $('#voiceQty').hidden = false;
else showManualQtyHint();
renderManual();
show('stepPhoto');
