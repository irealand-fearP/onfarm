import { validateRecognition } from '../schema.js';
import { VisionProviderError } from '../types.js';
import type { RecognitionResult, VisionInput, VisionProvider } from '../types.js';
import { buildVisionPrompt, extractJson } from './prompt.js';

/** Anthropic Claude 이미지 입력 provider. */
export class AnthropicVisionProvider implements VisionProvider {
  readonly name = 'anthropic';
  readonly offline = false;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async analyzeProduct(input: VisionInput): Promise<RecognitionResult> {
    if (!input.imageBase64) {
      throw new VisionProviderError('이미지가 없습니다.', this.name);
    }

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          max_tokens: 700,
          temperature: 0,
          system: buildVisionPrompt(input.catalog),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.mimeType ?? 'image/jpeg',
                    data: input.imageBase64,
                  },
                },
                { type: 'text', text: '이 사진의 농산물을 위 규칙대로 JSON 으로만 답하세요.' },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      throw new VisionProviderError('Anthropic 호출 실패(네트워크/타임아웃)', this.name, err);
    }

    if (!res.ok) {
      throw new VisionProviderError(`Anthropic 응답 오류 ${res.status}`, this.name);
    }

    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    const parsed = extractJson(text);
    if (!parsed) throw new VisionProviderError('JSON 파싱 실패', this.name);

    const validated = validateRecognition(parsed, input.catalog);
    if (!validated.ok) {
      throw new VisionProviderError(`스키마 불일치: ${validated.errors.join(', ')}`, this.name);
    }
    return validated.value;
  }
}
