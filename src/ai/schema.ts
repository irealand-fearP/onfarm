import type { QualityHint } from '../domain/types.js';
import type { CatalogItem, RecognitionResult } from './types.js';

export type ValidationResult =
  | { ok: true; value: RecognitionResult }
  | { ok: false; errors: string[] };

const QUALITY_HINTS: QualityHint[] = ['특', '상', '보통', '확인필요'];

function isQualityHint(v: unknown): v is QualityHint {
  return typeof v === 'string' && (QUALITY_HINTS as string[]).includes(v);
}

const MAX_ITEMS = 8;
const MAX_LEN = 120;

/**
 * 소비자에게 그대로 게시되면 안 되는 클레임.
 * 사진 한 장으로는 확인 불가능한 사실이라, LLM 이 지어내면 허위표시가 된다.
 * (프롬프트 지시는 런타임 검증을 대신하지 못한다)
 */
const FORBIDDEN_CLAIM =
  /(무농약|유기농|친환경|잔류\s*농약|농약\s*검사|안전성|살균|무첨가|GAP\s*인증|HACCP|인증\s*(완료|받)|당도\s*\d|브릭스|국내\s*최초|최저가|100\s*%)/;

export function hasForbiddenClaim(text: string): boolean {
  return FORBIDDEN_CLAIM.test(text);
}

function asStringArray(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  if (v.length > MAX_ITEMS) return null;
  if (!v.every((x) => typeof x === 'string' && x.length <= MAX_LEN)) return null;
  // 금지 클레임이 섞인 문장은 통째로 버린다(전체 거부 대신 해당 문장만 제거).
  return (v as string[]).filter((s) => !hasForbiddenClaim(s));
}

/**
 * provider(특히 LLM) 응답을 계약 스키마로 검증한다.
 * 지어낸 품목(카탈로그에 없는 code)은 거부한다 — 가격/SKU 가 존재하지 않기 때문.
 */
export function validateRecognition(raw: unknown, catalog: CatalogItem[]): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['응답이 객체가 아닙니다.'] };
  }
  const r = raw as Record<string, unknown>;

  const product = typeof r['product'] === 'string' ? r['product'].trim() : '';
  if (!product) errors.push('product 누락');

  const known = catalog.find((c) => c.code === product);
  if (product && catalog.length > 0 && !known) {
    errors.push(`카탈로그에 없는 품목: ${product}`);
  }

  // "0.99" 같은 문자열을 숫자로 강제 변환하지 않는다 — 계약 위반은 계약 위반이다.
  let confidence = 0;
  if (typeof r['confidence'] !== 'number' || !Number.isFinite(r['confidence'])) {
    errors.push('confidence 는 숫자여야 합니다.');
  } else {
    confidence = Math.min(1, Math.max(0, r['confidence']));
  }

  const qualityHint = isQualityHint(r['quality_hint']) ? r['quality_hint'] : null;
  if (r['quality_hint'] !== undefined && qualityHint === null) {
    errors.push(`quality_hint 값이 허용목록에 없습니다: ${String(r['quality_hint'])}`);
  }

  const issues = asStringArray(r['detected_issues']);
  if (issues === null) errors.push('detected_issues 는 문자열 배열이어야 합니다.');
  const basis = asStringArray(r['description_basis']);
  if (basis === null) errors.push('description_basis 는 문자열 배열이어야 합니다.');

  if (errors.length > 0) return { ok: false, errors };

  const alternatives: RecognitionResult['alternatives'] = [];
  if (Array.isArray(r['alternatives'])) {
    for (const alt of r['alternatives'] as unknown[]) {
      if (typeof alt !== 'object' || alt === null) continue;
      const a = alt as Record<string, unknown>;
      const code = typeof a['product'] === 'string' ? a['product'] : '';
      const item = catalog.find((c) => c.code === code);
      if (!item) continue;
      alternatives.push({
        product: code,
        product_ko: item.name_ko,
        confidence: Math.min(1, Math.max(0, Number(a['confidence']) || 0)),
      });
    }
  }

  const value: RecognitionResult = {
    category: known?.category ?? (typeof r['category'] === 'string' ? r['category'] : 'unknown'),
    product,
    product_ko: known?.name_ko ?? (typeof r['product_ko'] === 'string' ? r['product_ko'] : product),
    // 품종 추정은 제목에 그대로 들어가므로 길이·클레임을 검사하고,
    // 걸리면 카탈로그에 등록된 품종으로 되돌린다.
    variety_guess: (() => {
      const raw = typeof r['variety_guess'] === 'string' ? r['variety_guess'].trim() : '';
      if (!raw || raw.length > 30 || hasForbiddenClaim(raw)) return known?.variety ?? null;
      return raw;
    })(),
    quality_hint: qualityHint ?? '확인필요',
    confidence,
    detected_issues: issues ?? [],
    description_basis: basis ?? [],
    alternatives,
  };
  return { ok: true, value };
}

/** 어떤 이유로든 품목을 못 정했을 때 쓰는 안전한 기본값(=수동 선택 유도). */
export function unknownRecognition(reason: string): RecognitionResult {
  return {
    category: 'unknown',
    product: '',
    product_ko: '',
    variety_guess: null,
    quality_hint: '확인필요',
    confidence: 0,
    detected_issues: [reason],
    description_basis: [],
    alternatives: [],
  };
}
