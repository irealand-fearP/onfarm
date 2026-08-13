import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dominantHue, HeuristicVisionProvider, scoreCandidates } from '../ai/providers/heuristic.js';
import type { CatalogItem, ImageFeatures } from '../ai/types.js';

const catalog: CatalogItem[] = [
  { code: 'pear', name_ko: '배', category: 'fruit', variety: '신고배' },
  { code: 'apple', name_ko: '사과', category: 'fruit', variety: '부사' },
  { code: 'mandarin', name_ko: '감귤', category: 'fruit', variety: '노지감귤' },
  { code: 'potato', name_ko: '감자', category: 'root', variety: '수미감자' },
];

/** 특정 색상각에 몰린 히스토그램을 만든다(15도 단위 24칸 — 실제 features.js 와 같은 해상도). */
function histogramAt(hueDeg: number): number[] {
  const bins = new Array(24).fill(0.002);
  const idx = Math.floor(hueDeg / 15) % 24;
  bins[idx] = 0.8;
  bins[(idx + 1) % 24] = 0.06;
  bins[(idx + 23) % 24] = 0.06;
  const sum = bins.reduce((a, b) => a + b, 0);
  return bins.map((b) => b / sum);
}

function features(overrides: Partial<ImageFeatures> = {}): ImageFeatures {
  return {
    width: 256,
    height: 192,
    hueHistogram: histogramAt(37),
    meanSaturation: 0.73,
    meanValue: 0.86,
    edgeDensity: 0.07,
    hueConcentration: 0.7,
    ...overrides,
  };
}

describe('로컬 색·질감 판정', () => {
  it('대표 색상각을 최빈 구간 근처에서 찾는다', () => {
    const hue = dominantHue(histogramAt(210));
    assert.ok(Math.abs(hue - 217) < 20, `예상 210~225 근처, 실제 ${hue}`);
  });

  it('배 표피색(황금빛 갈색) 신호면 배가 1순위', () => {
    const ranked = scoreCandidates(features(), catalog.map((c) => c.code));
    assert.equal(ranked[0]?.code, 'pear');
  });

  it('진한 빨강 + 높은 채도면 사과가 배보다 앞선다', () => {
    const ranked = scoreCandidates(
      features({ hueHistogram: histogramAt(3), meanSaturation: 0.65, meanValue: 0.88, edgeDensity: 0.12 }),
      catalog.map((c) => c.code),
    );
    assert.equal(ranked[0]?.code, 'apple');
    assert.ok((ranked.find((r) => r.code === 'pear')?.probability ?? 1) < (ranked[0]?.probability ?? 0));
  });

  it('주황 + 아주 높은 채도면 감귤', () => {
    const ranked = scoreCandidates(
      features({ hueHistogram: histogramAt(31), meanSaturation: 0.88, meanValue: 0.91, edgeDensity: 0.06 }),
      catalog.map((c) => c.code),
    );
    assert.equal(ranked[0]?.code, 'mandarin');
  });

  it('카탈로그에 없는 품목은 후보에서 빠진다', () => {
    const ranked = scoreCandidates(features(), ['potato']);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.code, 'potato');
  });

  it('특징이 없으면 신뢰도 0 으로 돌려 수동 선택을 유도한다', async () => {
    const provider = new HeuristicVisionProvider();
    const result = await provider.analyzeProduct({ catalog });
    assert.equal(result.confidence, 0);
    assert.equal(result.product, '');
    assert.ok(result.detected_issues.length > 0);
  });

  it('어두운 사진은 같은 색이어도 신뢰도가 낮아진다', async () => {
    const provider = new HeuristicVisionProvider();
    // 품목 하나로 좁혀 후보 경쟁(softmax)의 영향을 빼고, 사진 품질에 따른 신뢰도 감점만 본다.
    const onlyPear = catalog.filter((c) => c.code === 'pear');
    const bright = await provider.analyzeProduct({ features: features(), catalog: onlyPear });
    const dark = await provider.analyzeProduct({
      features: features({ meanValue: 0.1 }),
      catalog: onlyPear,
    });
    assert.ok(dark.confidence < bright.confidence, `어두운 사진 ${dark.confidence} < 밝은 사진 ${bright.confidence}`);
    assert.equal(dark.quality_hint, '확인필요');
  });

  it('신뢰도 상한을 넘겨 확신하는 척하지 않는다', async () => {
    const provider = new HeuristicVisionProvider();
    const result = await provider.analyzeProduct({ features: features(), catalog });
    assert.ok(result.confidence <= 0.86);
  });
});
