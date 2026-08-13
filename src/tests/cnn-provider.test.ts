/**
 * CNN provider 는 모델이 없어도 앱을 깨뜨리면 안 된다.
 * (학습 결과가 나오기 전까지 서버는 기존 로컬 판정으로 돌아야 한다)
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { CnnVisionProvider, capConfidence, gradeIsUsable, loadMetadata } from '../ai/providers/cnn.js';
import type { CnnMetadata } from '../ai/providers/cnn.js';
import { VisionProviderError } from '../ai/types.js';

const work = mkdtempSync(join(tmpdir(), 'onfarm-cnn-'));
after(() => rmSync(work, { recursive: true, force: true }));

function meta(overrides: Partial<CnnMetadata> = {}): CnnMetadata {
  return {
    items: ['배', '사과'],
    grades: ['보통', '상', '특'],
    img_size: 224,
    normalize: { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
    val_object_level: { item: 0.82, grade: 0.55, n_objects: 577 },
    weight_only_grade_baseline: 0.61,
    ...overrides,
  };
}

describe('CNN provider — 모델이 없을 때', () => {
  it('메타데이터가 없으면 생성에 실패한다(앱은 폴백으로 계속 돈다)', async () => {
    await assert.rejects(
      () => CnnVisionProvider.create(join(work, 'nowhere')),
      (err: unknown) => err instanceof VisionProviderError,
    );
  });

  it('메타데이터만 있고 모델 파일이 없으면 실패한다', async () => {
    const dir = join(work, 'meta-only');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(meta()), 'utf8');
    await assert.rejects(
      () => CnnVisionProvider.create(dir),
      (err: unknown) => err instanceof VisionProviderError && /모델 파일 없음/.test(err.message),
    );
  });

  it('깨진 메타데이터를 거부한다', () => {
    const dir = join(work, 'bad-meta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ items: [] }), 'utf8');
    assert.throws(() => loadMetadata(dir), (e: unknown) => e instanceof VisionProviderError);
  });
});

describe('CNN provider — 확신도 상한', () => {
  it('개체 단위 검증 정확도를 넘는 확신도를 잘라낸다', () => {
    // 모델이 0.99 를 불러도 실측 상한(0.82)을 넘겨 표시하지 않는다
    assert.equal(capConfidence(0.99, meta()), 0.82);
    assert.equal(capConfidence(0.5, meta()), 0.5);
  });

  it('메타데이터에 수치가 없으면 보수적인 기본값을 쓴다', () => {
    assert.equal(capConfidence(0.99, meta({ val_object_level: {} })), 0.8);
  });
});

describe('CNN provider — 등급 사용 가능 판단', () => {
  it('중량 단독 기준선을 넘으면 등급을 쓴다', () => {
    assert.equal(gradeIsUsable(meta({ val_object_level: { grade: 0.7 }, weight_only_grade_baseline: 0.61 })), true);
  });

  it('기준선을 못 넘으면 등급을 쓰지 않는다 — 사진으로 등급을 본다고 말하지 않는다', () => {
    assert.equal(gradeIsUsable(meta()), false, '0.55 는 기준선 0.61 보다 낮다');
  });

  it('수치가 없으면 쓰지 않는다', () => {
    assert.equal(gradeIsUsable(meta({ weight_only_grade_baseline: undefined })), false);
  });

  it('전체 평균이 통과해도 그 품목이 기준선을 못 넘으면 막는다(양파)', () => {
    // 전체 0.7 > 0.61 로 통과하지만, 양파는 0.388 로 중량 기준선 0.738 에 못 미친다.
    const m = meta({
      val_object_level: { grade: 0.7 },
      weight_only_grade_baseline: 0.61,
      per_item: {
        양파: { grade_object_acc: 0.388, weight_only_baseline: 0.738, grade_usable: false },
        배: { grade_object_acc: 1, weight_only_baseline: 0.438, grade_usable: true },
      },
    });
    assert.equal(gradeIsUsable(m, '양파'), false);
    assert.equal(gradeIsUsable(m, '배'), true);
    assert.equal(gradeIsUsable(m, '사과'), true, 'per_item 이 없는 품목은 전체 평균으로 판단한다');
  });
});

describe('CNN provider — 입력 텐서 변환', () => {
  function provider(m: CnnMetadata = meta()): CnnVisionProvider {
    // 생성자는 private 이므로 변환 로직만 떼어 검사한다.
    return Object.create(CnnVisionProvider.prototype, {
      meta: { value: m },
    }) as CnnVisionProvider;
  }

  it('픽셀 길이가 맞지 않으면 거부한다', () => {
    assert.throws(
      () => provider().toTensor(new Uint8Array(100)),
      (e: unknown) => e instanceof VisionProviderError && /픽셀 길이/.test(e.message),
    );
  });

  it('정규화가 ImageNet 기준과 일치한다', () => {
    const size = 224;
    const rgb = new Uint8Array(size * size * 3).fill(255);
    const t = provider().toTensor(rgb);
    // (1 - mean) / std
    assert.ok(Math.abs((t[0] as number) - (1 - 0.485) / 0.229) < 1e-5);
    const plane = size * size;
    assert.ok(Math.abs((t[plane] as number) - (1 - 0.456) / 0.224) < 1e-5);
    assert.ok(Math.abs((t[2 * plane] as number) - (1 - 0.406) / 0.225) < 1e-5);
  });

  it('채널 우선(NCHW) 순서로 배치한다', () => {
    const size = 224;
    const rgb = new Uint8Array(size * size * 3);
    rgb[0] = 255; // 첫 픽셀의 R 만 255
    const t = provider().toTensor(rgb);
    const plane = size * size;
    assert.ok((t[0] as number) > (t[plane] as number), 'R 평면이 G 평면보다 커야 한다');
  });
});
