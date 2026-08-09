import type { CatalogItem } from '../types.js';

/**
 * 모든 LLM provider 가 공유하는 프롬프트.
 * - 카탈로그 안의 code 만 쓰게 강제한다(없는 품목 → SKU/가격이 없어 등록 불가).
 * - 등급은 '참고 판정'이며 확정하지 말라고 명시한다.
 * - 가격은 절대 생성하지 않는다(가격은 운영자가 등록한 표준 SKU 에서만 온다).
 */
export function buildVisionPrompt(catalog: CatalogItem[]): string {
  const list = catalog.map((c) => `- ${c.code}: ${c.name_ko}${c.variety ? ` (${c.variety})` : ''}`).join('\n');
  return [
    '당신은 농산물 사진을 보고 품목을 식별하는 보조 도구입니다.',
    '반드시 아래 목록에 있는 code 중 하나만 product 로 답하세요. 목록에 없으면 confidence 를 0.2 이하로 낮추세요.',
    list,
    '',
    '규칙:',
    '1) 가격, 금액, 원 단위 숫자를 절대 만들지 마세요.',
    '2) quality_hint 는 확정 등급이 아니라 사진으로 본 참고값입니다. "특","상","보통","확인필요" 중 하나만 쓰세요.',
    '3) 사진만으로 알 수 없는 것(당도, 잔류농약, 안전성, 내부 상태)은 판단하지 말고 detected_issues 에 적지 마세요.',
    '4) description_basis 에는 사진에서 실제로 보이는 근거만 짧은 한국어 문장으로 적으세요.',
    '5) JSON 외의 텍스트를 출력하지 마세요.',
    '',
    '출력 형식:',
    '{"category":"fruit","product":"pear","product_ko":"배","variety_guess":"신고배","quality_hint":"상","confidence":0.91,"detected_issues":[],"description_basis":["외관이 비교적 균일함"],"alternatives":[{"product":"apple","confidence":0.05}]}',
  ].join('\n');
}

/** 코드블록/여분 텍스트가 섞여 와도 첫 JSON 객체를 건져낸다. */
export function extractJson(text: string): unknown | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
