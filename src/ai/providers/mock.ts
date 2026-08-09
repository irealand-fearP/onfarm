import type { RecognitionResult, VisionInput, VisionProvider } from '../types.js';

/**
 * 시연 고정 응답. 무대에서 조명·카메라 상태와 무관하게 같은 화면을 보여줘야 할 때만 쓴다.
 * 이 provider 가 켜지면 화면 상단에 '데모 모드' 배지가 반드시 표시된다(server 가 내려줌).
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock';
  readonly offline = true;

  constructor(private readonly fixedCode = 'pear') {}

  async analyzeProduct(input: VisionInput): Promise<RecognitionResult> {
    const item =
      input.catalog.find((c) => c.code === this.fixedCode) ?? input.catalog[0] ?? null;
    if (!item) {
      return {
        category: 'unknown',
        product: '',
        product_ko: '',
        variety_guess: null,
        quality_hint: '확인필요',
        confidence: 0,
        detected_issues: ['카탈로그가 비어 있습니다.'],
        description_basis: [],
        alternatives: [],
      };
    }
    return {
      category: item.category,
      product: item.code,
      product_ko: item.name_ko,
      variety_guess: item.variety,
      quality_hint: '상',
      confidence: 0.91,
      detected_issues: [],
      description_basis: ['외관이 비교적 균일함', '뚜렷한 큰 상처가 보이지 않음'],
      alternatives: [],
    };
  }
}
