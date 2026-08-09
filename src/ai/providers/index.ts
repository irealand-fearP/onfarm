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
    case 'heuristic':
    default:
      return new HeuristicVisionProvider();
  }
}

let cached: ProviderSelection | null = null;

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
