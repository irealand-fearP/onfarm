import { config } from '../../config.js';
import type { AiProviderName } from '../../config.js';
import type { VisionProvider } from '../types.js';
import { AnthropicVisionProvider } from './anthropic.js';
import { HeuristicVisionProvider } from './heuristic.js';
import { MockVisionProvider } from './mock.js';
import { OpenAiVisionProvider } from './openai.js';

export interface ProviderSelection {
  /** 실제로 먼저 시도할 provider */
  primary: VisionProvider;
  /** primary 가 실패했을 때 쓰는 로컬 provider (항상 존재) */
  fallback: VisionProvider;
  /** 설정된 provider 를 쓰지 못하고 강등된 경우의 사유 */
  degradedReason: string | null;
  /** 화면에 '데모 모드' 배지를 띄워야 하는가 */
  demoMode: boolean;
}

export function createProvider(name: AiProviderName): VisionProvider | { error: string } {
  switch (name) {
    case 'openai':
      if (!config.ai.openaiKey) return { error: 'OPENAI_API_KEY 가 없습니다.' };
      return new OpenAiVisionProvider(config.ai.openaiKey, config.ai.openaiModel, config.ai.timeoutMs);
    case 'anthropic':
      if (!config.ai.anthropicKey) return { error: 'ANTHROPIC_API_KEY 가 없습니다.' };
      return new AnthropicVisionProvider(
        config.ai.anthropicKey,
        config.ai.anthropicModel,
        config.ai.timeoutMs,
      );
    case 'mock':
      return new MockVisionProvider();
    case 'cnn':
      // 비동기 로딩이라 여기서는 만들 수 없다. initProvider() 가 서버 시작 때 처리한다.
      return { error: '학습 모델은 서버 시작 시 준비됩니다.' };
    case 'heuristic':
    default:
      return new HeuristicVisionProvider();
  }
}

let cached: ProviderSelection | null = null;

/**
 * CNN provider 는 모델 파일과 onnxruntime 로딩이 필요해 비동기다.
 * 서버 시작 때 한 번 시도하고, 실패하면 사유를 남긴 채 로컬 판정으로 내려앉는다.
 * (실패가 서버 기동을 막지 않는다 — AI 가 없어도 판매는 돌아야 한다)
 */
export async function initProvider(): Promise<ProviderSelection> {
  const fallback = new HeuristicVisionProvider();
  if (config.ai.provider !== 'cnn') return resolveProvider();
  try {
    const { CnnVisionProvider } = await import('./cnn.js');
    const cnn = await CnnVisionProvider.create(config.ai.cnnModelDir);
    cached = { primary: cnn, fallback, degradedReason: null, demoMode: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    cached = {
      primary: fallback,
      fallback,
      degradedReason: `학습 모델을 쓰지 못했습니다 — ${reason} 로컬 규칙 판정으로 동작합니다.`,
      demoMode: false,
    };
  }
  return cached;
}

export function resolveProvider(): ProviderSelection {
  if (cached) return cached;
  const fallback = new HeuristicVisionProvider();
  const wanted = config.ai.provider;
  const made = createProvider(wanted);

  if ('error' in made) {
    cached = {
      primary: fallback,
      fallback,
      degradedReason: `${wanted} 사용 불가 — ${made.error} 로컬 규칙 판정으로 동작합니다.`,
      demoMode: false,
    };
  } else {
    cached = {
      primary: made,
      fallback,
      degradedReason: null,
      demoMode: wanted === 'mock',
    };
  }
  return cached;
}

/** 테스트용: 캐시를 비운다. */
export function resetProviderCache(): void {
  cached = null;
}

export { HeuristicVisionProvider, MockVisionProvider, OpenAiVisionProvider, AnthropicVisionProvider };
