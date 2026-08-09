import type { QualityHint } from '../domain/types.js';
import type { ImageFeatures } from './types.js';

export interface QualityAnalysis {
  /** '참고 판정'. 어떤 경우에도 확정 등급이 아니며 화면 문구도 그렇게 표기한다. */
  hint: QualityHint;
  issues: string[];
  basis: string[];
  /** 이미지 신호 자체가 얼마나 쓸만한지(0..1). 인식 신뢰도를 깎는 데 쓴다. */
  signalQuality: number;
}

/**
 * 이미지 특징만으로 '외관 상태'에 대한 참고 신호를 만든다.
 * 규칙 기반이며, 병해·잔류농약·내부 품질은 판단하지 않는다.
 */
export function analyzeQuality(features?: ImageFeatures): QualityAnalysis {
  if (!features) {
    return {
      hint: '확인필요',
      issues: ['사진에서 색·질감 정보를 읽지 못했습니다.'],
      basis: [],
      signalQuality: 0,
    };
  }

  const { meanValue, meanSaturation, edgeDensity, hueConcentration } = features;
  const issues: string[] = [];
  const basis: string[] = [];

  let signal = 1;

  if (meanValue < 0.28) {
    issues.push('사진이 어두워 외관 확인이 어렵습니다.');
    signal -= 0.35;
  } else if (meanValue > 0.93) {
    issues.push('빛 반사가 강해 색 판단이 어렵습니다.');
    signal -= 0.25;
  }

  if (meanSaturation < 0.12) {
    issues.push('색이 거의 없어 품목 구분이 어렵습니다.');
    signal -= 0.3;
  }

  if (hueConcentration < 0.3) {
    issues.push('배경과 농산물이 잘 구분되지 않습니다.');
    signal -= 0.2;
  } else if (hueConcentration >= 0.55) {
    basis.push('사진 전체에서 색이 비교적 고르게 나타납니다.');
  }

  if (edgeDensity > 0.62) {
    issues.push('표면 굴곡·그림자가 많아 외관을 단정하기 어렵습니다.');
    signal -= 0.15;
  } else if (edgeDensity <= 0.35) {
    basis.push('큰 상처로 보일 만한 뚜렷한 음영이 적습니다.');
  }

  signal = Math.max(0, Math.min(1, signal));

  let hint: QualityHint = '보통';
  if (issues.length > 0) {
    hint = '확인필요';
  } else if (hueConcentration >= 0.55 && edgeDensity <= 0.35 && meanSaturation >= 0.25) {
    hint = '상';
  }

  if (basis.length === 0) basis.push('사진 기반으로 확인 가능한 범위의 정보만 반영했습니다.');

  return { hint, issues, basis, signalQuality: signal };
}
