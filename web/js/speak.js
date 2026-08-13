// 고령 사용자용 음성 안내(TTS) + 음성 수량 입력(STT).
// 둘 다 브라우저 기능이라 없으면 조용히 비활성화되고, 화면 조작만으로 모든 흐름이 끝난다.
import { parseKoreanQuantity } from '/js/shared/korean.js';

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let lastText = '';

export function speak(text, { force = false } = {}) {
  if (!canSpeak() || !text) return false;
  if (!force && text === lastText && speechSynthesis.speaking) return false;
  lastText = text;
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

export function repeatLast() {
  if (lastText) speak(lastText, { force: true });
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
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
