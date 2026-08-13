/**
 * 다중 배율 판정(TTA)이 실제로 동작하는지 검사한다.
 *
 * 이 기능이 없으면 "멀리서 찍은 감자"가 후보 3개 안에도 들어오지 않는다(실측 top-3 0%).
 * 그래서 여기서 지키는 것은 정확도 자체가 아니라, 정확도를 만들어 내는 **구조**다.
 *   · 중앙 크롭이 실제로 확대하는가 (같은 그림을 그대로 돌려주면 TTA 는 아무 일도 안 한다)
 *   · 합쳐진 확률이 합 1로 되돌아오는가 (안 하면 화면 신뢰도가 부풀려진다)
 *   · 배율 목록이 1.0 을 포함하고 충분히 촘촘한가
 *   · 신뢰도 상한(capConfidence)이 합친 확률 위에도 그대로 걸리는가
 *
 * 팀원 저장소는 이 중 절반을 소스 문자열 grep 으로 검사했지만, 우리는 값을 직접 계산해서 본다
 * (문자열 검사는 리팩터링만 해도 빨간불이 되고, 실제 동작은 보장하지 못한다).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CnnVisionProvider,
  TTA_SCALES,
  capConfidence,
  fuseItemProbs,
} from '../ai/providers/cnn.js';
import type { CnnMetadata } from '../ai/providers/cnn.js';

/** cropCenter 는 meta.img_size 만 본다 — 모델 없이도 부를 수 있다. */
const crop = (rgb: Uint8Array, scale: number): Uint8Array =>
  (CnnVisionProvider.prototype as unknown as {
    cropCenter: (r: Uint8Array, s: number) => Uint8Array;
  }).cropCenter.call({ meta: { img_size: 224 } }, rgb, scale);

/** 가운데에만 표식이 있는 224 그림 — 확대되면 표식이 커진다. */
function pixelsWithCenterMark(size = 224): Uint8Array {
  const rgb = new Uint8Array(size * size * 3).fill(200);
  const half = Math.floor(size / 2);
  for (let y = half - 8; y < half + 8; y += 1) {
    for (let x = half - 8; x < half + 8; x += 1) {
      const i = (y * size + x) * 3;
      rgb[i] = 10;
      rgb[i + 1] = 20;
      rgb[i + 2] = 30;
    }
  }
  return rgb;
}

function countDark(rgb: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < rgb.length; i += 3) if ((rgb[i] ?? 255) < 100) n += 1;
  return n;
}

describe('다중 배율 판정 — 중앙 크롭', () => {
  it('배율 1.0 은 원본을 그대로 돌려준다(복사본을 만들면 헛일이다)', () => {
    const src = pixelsWithCenterMark();
    assert.equal(crop(src, 1), src);
  });

  it('배율을 줄이면 가운데 표식이 실제로 커진다', () => {
    const src = pixelsWithCenterMark();
    const base = countDark(src);
    const half = countDark(crop(src, 0.5));
    const quarter = countDark(crop(src, 0.25));
    assert.ok(half > base * 3, `0.5 배율에서 표식이 ${base}→${half} 로 충분히 커지지 않았다`);
    assert.ok(quarter > half, `0.25 가 0.5 보다 크게 확대해야 한다 (${half} vs ${quarter})`);
  });

  it('어떤 배율에서도 크기가 224 로 유지된다', () => {
    for (const scale of [...TTA_SCALES, 0.05]) {
      assert.equal(crop(pixelsWithCenterMark(), scale).length, 224 * 224 * 3, `배율 ${scale}`);
    }
  });
});

describe('다중 배율 판정 — 배율 목록', () => {
  it('1.0 을 포함한다 — 빠지면 피사체가 치우쳤을 때 되레 나빠진다', () => {
    assert.ok(TTA_SCALES.includes(1));
  });

  it('배율이 3개 이상이고 전부 0 초과 1 이하다', () => {
    assert.ok(TTA_SCALES.length >= 3, `배율이 ${TTA_SCALES.length}개뿐 — 2개면 치우친 구도에서 퇴행한다`);
    assert.ok(TTA_SCALES.every((s) => s > 0 && s <= 1));
  });
});

describe('다중 배율 판정 — 확률 합치기', () => {
  it('합친 확률의 합은 1이다 — 신뢰도가 부풀려지면 안 된다', () => {
    const perScale = [
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
      [0.2, 0.3, 0.5],
    ];
    const fused = fuseItemProbs(perScale);
    const sum = fused.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `합이 ${sum} 이다`);
  });

  it('최댓값을 쓰되, 정규화 전 최댓값보다 커지지 않는다', () => {
    const perScale = [
      [0.9, 0.05, 0.05],
      [0.4, 0.4, 0.2],
    ];
    const fused = fuseItemProbs(perScale);
    // 최댓값 합치기 결과는 [0.9, 0.4, 0.2] → 합 1.5 로 나눈다.
    assert.ok(fused[0]! < 0.9, '정규화를 빼먹으면 1순위 확률이 0.9 그대로 남는다');
    assert.equal(fused.indexOf(Math.max(...fused)), 0, '1순위 품목은 그대로여야 한다');
  });

  it('배율이 모두 같은 답을 내도 확률이 1을 넘지 않는다', () => {
    const fused = fuseItemProbs([[0.95, 0.05], [0.95, 0.05], [0.95, 0.05]]);
    assert.ok(fused.every((p) => p <= 1));
    assert.ok(Math.abs(fused.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  });

  it('신뢰도 상한은 합친 확률 위에도 그대로 걸린다', () => {
    const meta = { val_object_level: { item: 0.8 } } as CnnMetadata;
    const fused = fuseItemProbs([[0.99, 0.01], [0.99, 0.01]]);
    assert.equal(capConfidence(fused[0]!, meta), 0.8);
  });
});
