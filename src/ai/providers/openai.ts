import { validateRecognition } from '../schema.js';
import { VisionProviderError } from '../types.js';
import type { RecognitionResult, VisionInput, VisionProvider } from '../types.js';
import { buildVisionPrompt, extractJson } from './prompt.js';

/** OpenAI 이미지 입력 모델 provider. 키가 없으면 생성 단계에서 거부한다. */
export class OpenAiVisionProvider implements VisionProvider {
  readonly name = 'openai';
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
    const dataUrl = `data:${input.mimeType ?? 'image/jpeg'};base64,${input.imageBase64}`;

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildVisionPrompt(input.catalog) },
            {
              role: 'user',
              content: [
                { type: 'text', text: '이 사진의 농산물을 위 규칙대로 JSON 으로만 답하세요.' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      throw new VisionProviderError('OpenAI 호출 실패(네트워크/타임아웃)', this.name, err);
    }

    if (!res.ok) {
      throw new VisionProviderError(`OpenAI 응답 오류 ${res.status}`, this.name);
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(text);
    if (!parsed) throw new VisionProviderError('JSON 파싱 실패', this.name);

    const validated = validateRecognition(parsed, input.catalog);
    if (!validated.ok) {
      throw new VisionProviderError(`스키마 불일치: ${validated.errors.join(', ')}`, this.name);
    }
    return validated.value;
  }
}
