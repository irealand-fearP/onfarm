import type { Farm, Product } from '../domain/types.js';
import type { SkuCandidate } from './sku-matcher.js';
import type { RecognitionResult } from './types.js';

export interface WriteInput {
  product: Product;
  sku: SkuCandidate;
  farm: Pick<Farm, 'farm_name' | 'region_sido' | 'region_sigungu' | 'region_detail'>;
  farmerName: string;
  recognition: RecognitionResult;
  harvestedOn: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  aiSourceLabel: string;
}

export interface WrittenProduct {
  title: string;
  description: string;
}

function shortRegion(farm: WriteInput['farm']): string {
  const sigungu = farm.region_sigungu.replace(/시$|군$/, '');
  return farm.region_detail ? `${sigungu} ${farm.region_detail}` : sigungu;
}

/**
 * 판매자가 한 글자도 쓰지 않아도 되도록 상품명/소개문을 만든다.
 * 규칙: 실제 DB 값과 사진 근거만 문장으로 옮긴다. 없는 사실(당도, 무농약, 최저가 등)은 쓰지 않는다.
 */
export function writeProduct(input: WriteInput): WrittenProduct {
  const { product, sku, farm, recognition, harvestedOn, today } = input;
  const when = harvestedOn === today ? '오늘' : `${harvestedOn.slice(5).replace('-', '월 ')}일`;
  const variety = recognition.variety_guess ?? product.variety ?? product.name_ko;

  const title = `${shortRegion(farm)}에서 ${when} 수확한 ${variety}`;

  const lines: string[] = [];
  lines.push(
    `${farm.region_sido} ${farm.region_sigungu}${farm.region_detail ? ` ${farm.region_detail}` : ''} ${farm.farm_name}에서 출하한 ${product.name_ko}입니다.`,
  );
  lines.push(`판매 단위는 ${sku.label}(${sku.weight}${sku.unit})입니다.`);

  if (recognition.description_basis.length > 0) {
    lines.push(
      `사진 확인 결과: ${recognition.description_basis.join(', ')} (${input.aiSourceLabel} 기준).`,
    );
  }
  if (recognition.detected_issues.length > 0) {
    lines.push(`사진에서 확인이 어려웠던 점: ${recognition.detected_issues.join(', ')}.`);
  }

  lines.push(
    `표시된 품질은 사진 기반 참고 판정이며, 최종 품질은 출하 전 지역 거점의 실물 검수로 확정됩니다.`,
  );

  return { title, description: lines.join('\n') };
}
