// 고령 사용자용 음성 안내(TTS) + 음성 수량 입력(STT).
// 둘 다 브라우저 기능이라 없으면 조용히 비활성화되고, 화면 조작만으로 모든 흐름이 끝난다.
import { parseKoreanQuantity } from '/js/shared/korean.js';

/*
  낭독은 두 갈래다.
   ① 서버 합성(Supertonic 3 · 화자 F1) — 기기와 상관없이 같은 목소리. 이쪽이 기본이다.
   ② 브라우저 내장 음성(Web Speech API) — 서버 합성을 못 쓸 때의 폴백.

  화면 코드는 예전 그대로 speak()·repeatLast() 만 부르면 된다. 갈래 선택은 여기서만 한다.
  음성 안내가 통째로 죽는 것이 제일 나쁘므로, 서버가 실패하면 조용히 ②로 내려앉는다.
*/

const TTS_ENDPOINT = '/api/tts';
const MAX_TTS_TEXT = 200;

/** 서버 합성을 쓸 수 있는가 — 한 번만 물어보고 결과를 기억한다. */
let serverProbe = null;
function serverAvailable() {
  if (!serverProbe) {
    serverProbe = fetch(`${TTS_ENDPOINT}/status`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { available: false }))
      .then((body) => body.available === true)
      .catch(() => false);
  }
  return serverProbe;
}

export function canSpeak() {
  if (typeof window === 'undefined') return false;
  // 서버 합성 여부는 비동기라 여기서 기다릴 수 없다. 둘 중 하나라도 가능성이 있으면 버튼을 보인다.
  return 'speechSynthesis' in window || typeof window.Audio === 'function';
}

let lastText = '';
let current = null; // 재생 중인 Audio
let token = 0; // 늦게 도착한 응답이 새 낭독을 덮어쓰지 못하게 하는 순번

/** 재생 중인 소리를 멈춘다(서버 오디오·내장 음성 둘 다). */
export function stopSpeaking() {
  token += 1;
  if (current) {
    try {
      current.pause();
      current.currentTime = 0;
    } catch {
      /* 이미 정리됨 */
    }
    current = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      speechSynthesis.cancel();
    } catch {
      /* 무시 */
    }
  }
}

/** 예전 그대로의 브라우저 내장 음성. 서버 합성을 못 쓸 때만 쓴다. */
function speakWithBrowser(text) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 0.92; // 조금 천천히
    utter.pitch = 1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('ko'));
    if (voice) utter.voice = voice;
    speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

/**
 * 서버에서 받은 소리를 재생한다.
 * @returns {Promise<'played'|'blocked'|'failed'>}
 *   blocked = 브라우저 자동재생 정책에 막힌 것. 이때는 폴백해도 어차피 막히므로 조용히 넘어간다.
 */
async function speakWithServer(text, mine) {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return 'failed';
  if (text.length > MAX_TTS_TEXT) return 'failed'; // 서버가 400 을 낼 문장은 아예 보내지 않는다
  if (!(await serverAvailable())) return 'failed';
  if (mine !== token) return 'played'; // 그 사이 다른 낭독이 시작됐다 — 이 건은 버린다

  let res;
  try {
    res = await fetch(`${TTS_ENDPOINT}?text=${encodeURIComponent(text)}`);
  } catch {
    return 'failed';
  }
  if (!res.ok) {
    // 503(자산 없음)이면 이후로는 서버에 묻지 않는다.
    if (res.status === 503) serverProbe = Promise.resolve(false);
    return 'failed';
  }
  if (mine !== token) return 'played';

  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });

  if (mine !== token) {
    URL.revokeObjectURL(url);
    return 'played';
  }
  if (current) {
    try {
      current.pause();
    } catch {
      /* 무시 */
    }
  }
  current = audio;

  try {
    await audio.play();
    return 'played';
  } catch (err) {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    // 사용자가 아직 아무것도 누르지 않아 막힌 경우다(화면 진입 자동 낭독).
    return err?.name === 'NotAllowedError' ? 'blocked' : 'failed';
  }
}

/**
 * 문장을 읽어 준다. 화면 코드가 쓰던 계약 그대로 boolean 을 즉시 돌려준다
 * (실제 재생은 비동기라 '읽기 시작했는가' 의 뜻이다).
 */
export function speak(text, { force = false } = {}) {
  if (!canSpeak() || !text) return false;
  const speaking = Boolean(current && !current.paused) ||
    (typeof window !== 'undefined' && 'speechSynthesis' in window && speechSynthesis.speaking);
  if (!force && text === lastText && speaking) return false;

  lastText = text;
  stopSpeaking(); // 겹쳐 들리지 않게 이전 소리를 먼저 끊는다(token 도 여기서 올라간다)
  const mine = token;

  void (async () => {
    const outcome = await speakWithServer(text, mine);
    if (outcome === 'failed' && mine === token) speakWithBrowser(text);
    // 'blocked' 는 폴백하지 않는다 — 내장 음성도 같은 정책에 막히고,
    // 사용자가 버튼을 누르면 그때 정상적으로 소리가 난다.
  })();

  return true;
}

export function repeatLast() {
  if (lastText) speak(lastText, { force: true });
}

function recognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function canListen() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * 한 번만 듣고 수량으로 해석한다.
 * @returns {Promise<{quantity:number|null, transcript:string}>}
 */
export function listenQuantity({ timeoutMs = 7000 } = {}) {
  return new Promise((resolve) => {
    const rec = recognizer();
    if (!rec) {
      resolve({ quantity: null, transcript: '' });
      return;
    }
    rec.lang = 'ko-KR';
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        rec.stop();
      } catch {
        /* 이미 종료됨 */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish({ quantity: null, transcript: '' }), timeoutMs);

    rec.onresult = (event) => {
      clearTimeout(timer);
      const alternatives = Array.from(event.results?.[0] ?? []).map((a) => a.transcript ?? '');
      for (const transcript of alternatives) {
        const quantity = parseKoreanQuantity(transcript);
        if (quantity) {
          finish({ quantity, transcript });
          return;
        }
      }
      finish({ quantity: null, transcript: alternatives[0] ?? '' });
    };
    rec.onerror = () => {
      clearTimeout(timer);
      finish({ quantity: null, transcript: '' });
    };
    rec.onend = () => {
      clearTimeout(timer);
      finish({ quantity: null, transcript: '' });
    };

    try {
      rec.start();
    } catch {
      clearTimeout(timer);
      finish({ quantity: null, transcript: '' });
    }
  });
}

export { parseKoreanQuantity };
