import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, PROJECT_ROOT } from '../config.js';

/**
 * 서버 음성 합성(Supertonic 3 · 화자 F1).
 *
 * 브라우저 내장 음성(Web Speech API)은 기기마다 목소리가 다르고 딱딱하다.
 * 어르신이 듣는 안내라 목소리 품질이 곧 사용성이라, 서버에서 한 목소리로 합성해 내려준다.
 *
 * 지켜야 할 것 세 가지:
 *  · 자산(약 380MB)이 없으면 **조용히 꺼진다**. 서버 기동을 막지 않고 화면은 내장 음성으로 내려앉는다.
 *  · 합성은 CPU 를 통째로 쓴다. 동시에 여러 개를 돌리면 서로 느려지므로 **한 번에 하나씩** 처리한다.
 *  · 같은 문장이 반복되는 시연이라 **디스크 캐시**가 사실상 전부다. 두 번째부터는 합성하지 않는다.
 */

/** 화자. 사장님 확정값이라 환경변수로 바꿀 수는 있어도 기본은 F1 이다. */
const VOICE = process.env['TTS_VOICE'] ?? 'F1';
/** 어르신 기준 낭독 속도. 1.05 가 원본 기본값이고, 그보다 느리게 읽는다. */
const SPEED = Number(process.env['TTS_SPEED'] ?? 0.92);
/** 확산 단계 수. 8 이 원본 권장값이며 줄이면 빨라지지만 발음이 뭉갠다. */
const TOTAL_STEP = Number(process.env['TTS_STEPS'] ?? 8);
/** 한 번에 합성할 수 있는 글자 수 상한. 공개 주소에서 긴 문장을 무한정 합성하게 두지 않는다. */
export const MAX_TEXT_LENGTH = 200;

export function assetsDir(): string {
  return process.env['TTS_ASSETS_DIR'] ?? join(PROJECT_ROOT, 'vendor', 'supertonic', 'assets');
}

function cacheDir(): string {
  return join(config.dataDir, 'tts-cache');
}

const REQUIRED_FILES = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
];

/** 자산이 전부 있는가. 하나라도 없으면 TTS 를 켜지 않는다(반쯤 켜는 게 제일 나쁘다). */
export function assetsReady(dir = assetsDir()): boolean {
  const voice = join(dir, 'voice_styles', `${VOICE}.json`);
  if (!existsSync(voice) || statSync(voice).size === 0) return false;
  return REQUIRED_FILES.every((rel) => {
    const path = join(dir, rel);
    return existsSync(path) && statSync(path).size > 0;
  });
}

/**
 * 읽을 수 있는 문장인가.
 *
 * 화면 안내 문구에 실제로 쓰이는 글자만 통과시킨다. 공개 주소에서 아무 텍스트나 받아
 * 합성해 주면 남의 TTS 서버로 쓰이고, CPU 를 통째로 가져간다.
 */
const ALLOWED = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%~\-·:()'"원개kgKG]+$/;

export type TextCheck = { ok: true; text: string } | { ok: false; reason: string };

export function checkText(raw: unknown): TextCheck {
  if (typeof raw !== 'string') return { ok: false, reason: '문장이 없습니다.' };
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: '문장이 비어 있습니다.' };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, reason: `문장이 ${MAX_TEXT_LENGTH}자를 넘습니다.` };
  }
  if (!ALLOWED.test(text)) return { ok: false, reason: '읽을 수 없는 문자가 있습니다.' };
  return { ok: true, text };
}

/**
 * 캐시 키. 문장뿐 아니라 **소리를 바꾸는 값 전부**를 넣는다.
 * 화자나 속도를 바꾸고도 옛날 소리가 나오면 원인을 찾기 어렵다.
 */
export function cacheKey(text: string): string {
  return createHash('sha256')
    .update(`${VOICE}|${SPEED}|${TOTAL_STEP}|${text}`)
    .digest('hex')
    .slice(0, 32);
}

function cachePath(text: string): string {
  return join(cacheDir(), `${cacheKey(text)}.wav`);
}

interface Engine {
  synth: (text: string) => Promise<Buffer>;
}

let engine: Engine | null = null;
let loading: Promise<Engine | null> | null = null;
let disabledReason: string | null = null;

/**
 * 엔진을 처음 쓸 때 한 번만 올린다(모델 로딩 약 0.5초).
 * 실패하면 사유를 남기고 다시는 시도하지 않는다 — 매 요청마다 재시도하면 요청이 느려진다.
 */
async function loadEngine(): Promise<Engine | null> {
  if (engine) return engine;
  if (disabledReason) return null;
  if (loading) return loading;

  loading = (async () => {
    const dir = assetsDir();
    if (!assetsReady(dir)) {
      disabledReason = `음성 합성 자산이 없습니다(${dir}).`;
      return null;
    }
    try {
      const helperUrl = pathToFileURL(join(PROJECT_ROOT, 'vendor/supertonic/helper.js')).href;
      const helper = (await import(helperUrl)) as {
        loadTextToSpeech: (onnxDir: string, useGpu?: boolean) => Promise<any>;
        loadVoiceStyle: (paths: string[], verbose?: boolean) => any;
        writeWavFile: (file: string, audio: Float32Array, rate: number) => void;
      };
      const tts = await helper.loadTextToSpeech(join(dir, 'onnx'), false);
      const style = helper.loadVoiceStyle([join(dir, 'voice_styles', `${VOICE}.json`)], false);

      const synth = async (text: string): Promise<Buffer> => {
        const { wav, duration } = await tts.call(text, 'ko', style, TOTAL_STEP, SPEED);
        const samples = Math.floor(tts.sampleRate * duration[0]);
        return wavBuffer(wav.slice(0, samples), tts.sampleRate);
      };
      return { synth };
    } catch (err) {
      disabledReason = `음성 합성을 켜지 못했습니다 — ${err instanceof Error ? err.message : String(err)}`;
      return null;
    }
  })();

  engine = await loading;
  loading = null;
  return engine;
}

/**
 * float 오디오를 16bit PCM WAV 로 만든다.
 *
 * 들여온 helper.writeWavFile 은 파일로만 쓸 수 있어서, 캐시에 넣기 전에 임시 파일을 거치게 된다.
 * 응답은 어차피 메모리에 실어야 하므로 같은 형식(mono 16bit)을 여기서 직접 만든다.
 */
export function wavBuffer(samples: Float32Array | number[], sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/** 합성 대기줄. CPU 를 통째로 쓰는 작업이라 한 번에 하나만 돌린다. */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export interface SpeechResult {
  wav: Buffer;
  cached: boolean;
}

/**
 * 문장 하나를 소리로 만든다. 캐시에 있으면 합성하지 않는다.
 * TTS 를 못 쓰는 환경이면 null 을 돌려준다 — 호출자가 화면 폴백으로 넘긴다.
 */
export async function speak(text: string): Promise<SpeechResult | null> {
  const path = cachePath(text);
  if (existsSync(path)) return { wav: readFileSync(path), cached: true };

  const eng = await loadEngine();
  if (!eng) return null;

  return serialize(async () => {
    // 대기줄에서 기다리는 동안 다른 요청이 같은 문장을 만들어 놨을 수 있다.
    if (existsSync(path)) return { wav: readFileSync(path), cached: true };
    const wav = await eng.synth(text);
    try {
      mkdirSync(cacheDir(), { recursive: true });
      // 다 쓰기 전 파일을 다른 요청이 읽어 가면 잘린 소리가 난다 — 임시 이름으로 쓰고 옮긴다.
      const tmp = `${path}.${process.pid}.part`;
      writeFileSync(tmp, wav);
      renameSync(tmp, path);
    } catch {
      /* 캐시를 못 써도 소리는 내보낸다 */
    }
    return { wav, cached: false };
  });
}

/** 화면이 서버 음성을 쓸 수 있는지 미리 물어보는 값. */
export function ttsStatus(): { available: boolean; reason: string | null; voice: string } {
  const available = assetsReady();
  return {
    available,
    reason: available ? disabledReason : (disabledReason ?? '음성 합성 자산이 없습니다.'),
    voice: VOICE,
  };
}

/**
 * 시연에서 반드시 나오는 고정 멘트. 기동 후 백그라운드로 미리 만들어 캐시에 넣는다.
 * 첫 문장이 1초 가까이 걸리는데, 그게 하필 화면 진입 안내라 시연이 어색해진다.
 */
export const WARMUP_LINES = [
  '무엇을 파실까요?',
  '사진을 확인했습니다.',
  '사진을 자동으로 확인하지 못했습니다. 무엇을 파실까요?',
  '판매가 시작됐습니다.',
];

/** 기동을 막지 않는다 — 실패해도 조용히 넘어간다. */
export function warmUp(lines: string[] = WARMUP_LINES): void {
  if (!assetsReady()) return;
  void (async () => {
    for (const line of lines) {
      try {
        await speak(line);
      } catch {
        return;
      }
    }
  })();
}
