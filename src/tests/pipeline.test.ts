import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runPipeline } from '../ai/pipeline.js';
import { HeuristicVisionProvider } from '../ai/providers/heuristic.js';
import { MockVisionProvider } from '../ai/providers/mock.js';
import type { ProviderSelection } from '../ai/providers/index.js';
import { VisionProviderError } from '../ai/types.js';
import type { ImageFeatures, RecognitionResult, VisionProvider } from '../ai/types.js';
import { farmerNamed, freshDb } from './helpers.js';

class AlwaysFailingProvider implements VisionProvider {
  readonly name = 'openai';
  readonly offline = false;
  async analyzeProduct(): Promise<RecognitionResult> {
    throw new VisionProviderError('OpenAI 호출 실패(네트워크/타임아웃)', 'openai');
  }
}

function selection(primary: VisionProvider, fallback: VisionProvider = new HeuristicVisionProvider()): ProviderSelection {
  return { primary, fallback, degradedReason: null, demoMode: primary.name === 'mock' };
}

function pearFeatures(overrides: Partial<ImageFeatures> = {}): ImageFeatures {
  const bins = new Array(12).fill(0.01);
  bins[1] = 0.8; // 30~60도 = 노랑-연두
  bins[2] = 0.1;
  const sum = bins.reduce((a: number, b: number) => a + b, 0);
  return {
    width: 256,
    height: 192,
    hueHistogram: bins.map((b: number) => b / sum),
    meanSaturation: 0.35,
    meanValue: 0.62,
    edgeDensity: 0.3,
    hueConcentration: 0.72,
    ...overrides,
  };
}

describe('AI 파이프라인', () => {
  it('사진 → 품목 → SKU → 문안까지 한 번에 만든다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures(), farm, farmerName: user.name },
      selection(new MockVisionProvider('pear')),
    );

    assert.equal(result.recognition.product, 'pear');
    assert.equal(result.decision.mode, 'auto');
    assert.equal(result.selectedSku?.code, 'pear_shingo_5kg');
    assert.equal(result.selectedSku?.price, 29000);
    assert.equal(result.skus.length, 2);
    assert.match(result.draft?.title ?? '', /천안 성환읍에서 오늘 수확한 신고배/);
    assert.match(result.draft?.description ?? '', /5kg 한 상자/);
    assert.match(result.draft?.description ?? '', /출하 전 지역 거점의 실물 검수/);
    assert.equal(result.ai.demoMode, true);
  });

  it('상품 문안에 가격을 지어내지 않는다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures(), farm, farmerName: user.name },
      selection(new MockVisionProvider('pear')),
    );
    assert.ok(!/\d{1,3},\d{3}원/.test(result.draft?.description ?? ''), '설명문에 금액이 들어가면 안 된다');
  });

  it('외부 provider 가 죽어도 로컬 판정으로 이어간다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures(), farm, farmerName: user.name },
      selection(new AlwaysFailingProvider()),
    );

    assert.equal(result.ai.source, 'heuristic');
    assert.match(result.ai.degraded ?? '', /openai 실패/);
    assert.equal(result.recognition.product, 'pear');
    assert.notEqual(result.decision.mode, undefined);
  });

  it('전부 실패해도 화면이 죽지 않고 직접 선택으로 넘어간다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures(), farm, farmerName: user.name },
      selection(new AlwaysFailingProvider(), new AlwaysFailingProvider()),
    );

    assert.equal(result.recognition.product, '');
    assert.equal(result.decision.mode, 'manual');
    assert.ok(result.catalog.length > 0, '직접 고를 품목 목록이 내려가야 한다');
    assert.equal(result.selectedSku, null);
  });

  it('사용자가 직접 고른 품목은 인식을 건너뛰고 그대로 쓴다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures(), forcedProductCode: 'apple', farm, farmerName: user.name },
      selection(new AlwaysFailingProvider()),
    );

    assert.equal(result.recognition.product, 'apple');
    assert.equal(result.recognition.confidence, 1);
    assert.equal(result.ai.source, 'manual');
    assert.equal(result.selectedSku?.price, 32000);
    assert.equal(result.decision.mode, 'auto');
  });

  it('사진이 나쁘면 provider 가 뭐라 하든 품질은 확인필요로 내린다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(
      db,
      { features: pearFeatures({ meanValue: 0.08 }), farm, farmerName: user.name },
      selection(new MockVisionProvider('pear')), // mock 은 항상 '상' 을 준다
    );
    assert.equal(result.recognition.quality_hint, '확인필요');
    assert.ok(result.recognition.detected_issues.some((i) => i.includes('어두워')));
  });

  it('특징이 아예 없으면 직접 선택 화면으로 보낸다', async () => {
    const db = freshDb(false);
    const { user, farm } = farmerNamed(db);
    const result = await runPipeline(db, { farm, farmerName: user.name }, selection(new HeuristicVisionProvider()));
    assert.equal(result.decision.mode, 'manual');
  });
});
