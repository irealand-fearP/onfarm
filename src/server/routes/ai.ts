import { runPipeline } from '../../ai/pipeline.js';
import type { ImageFeatures } from '../../ai/types.js';
import { db } from '../../db/index.js';
import { farmOf } from '../../domain/users.js';
import { HttpError } from '../../lib/http.js';
import type { Router } from '../../lib/http.js';
import { parseDataUrl, saveImage } from '../../lib/images.js';
import { requireRole } from '../../lib/session.js';
import { getAnalysis, putAnalysis, updateAnalysis } from '../analysis-store.js';

interface AnalyzeBody {
  image?: string;
  analysisId?: string;
  features?: ImageFeatures;
  /** 브라우저가 만든 224×224 RGB 픽셀(base64). 학습 모델 provider 만 쓴다. */
  pixels?: string;
  /** 폴백 화면에서 사용자가 직접 고른 품목 */
  productCode?: string;
}

const MODEL_PIXEL_BYTES = 224 * 224 * 3;

/** 길이가 정확히 맞을 때만 받는다. 아니면 조용히 버리고 로컬 판정으로 간다. */
function sanitizePixels(raw: unknown): Uint8Array | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return undefined;
  }
  if (buf.length !== MODEL_PIXEL_BYTES) return undefined;
  return new Uint8Array(buf);
}

function sanitizeFeatures(raw: unknown): ImageFeatures | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const f = raw as Record<string, unknown>;
  const hist = Array.isArray(f['hueHistogram'])
    ? (f['hueHistogram'] as unknown[]).map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
      })
    : null;
  // 칸 수는 클라이언트 버전에 따라 달라질 수 있어 범위만 검사한다(현재 24칸).
  if (!hist || hist.length < 8 || hist.length > 72) return undefined;
  const num = (key: string): number => {
    const n = Number(f[key]);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  };
  return {
    width: Number(f['width']) || 0,
    height: Number(f['height']) || 0,
    hueHistogram: hist,
    meanSaturation: num('meanSaturation'),
    meanValue: num('meanValue'),
    edgeDensity: num('edgeDensity'),
    hueConcentration: num('hueConcentration'),
  };
}

export function registerAiRoutes(router: Router): void {
  /**
   * STEP 3 — 사진 한 장을 받아 파이프라인 전체를 돌린다.
   * 같은 사진으로 다시 물어볼 때는 analysisId 만 보내면 된다(재업로드 없음).
   */
  router.post('/api/ai/analyze', async (ctx) => {
    const user = requireRole(ctx.user, 'farmer');
    const farm = farmOf(db(), user.id);
    if (!farm) throw new HttpError(400, '농가 정보가 없습니다.', 'no_farm');

    const body = await ctx.body<AnalyzeBody>();
    const features = sanitizeFeatures(body.features);
    const pixels = sanitizePixels(body.pixels);

    let imagePath: string | null = null;
    let imageBase64: string | null = null;
    let mimeType: string | null = null;
    let storedId: string | null = null;
    let storedFeatures = features ?? null;
    let storedPixels = pixels ?? null;

    if (body.analysisId) {
      const prev = getAnalysis(body.analysisId, user.id);
      if (!prev) throw new HttpError(410, '분석 결과가 만료되었습니다. 사진을 다시 찍어주세요.', 'expired');
      imagePath = prev.imagePath;
      imageBase64 = prev.imageBase64;
      mimeType = prev.mimeType;
      storedFeatures = features ?? prev.features;
      storedPixels = pixels ?? prev.pixels;
      storedId = prev.id;
    } else if (body.image) {
      const parsed = parseDataUrl(body.image);
      const saved = saveImage(parsed);
      imagePath = saved.publicPath;
      imageBase64 = parsed.base64;
      mimeType = parsed.mimeType;
    } else {
      throw new HttpError(400, '사진이 필요합니다.', 'bad_request');
    }

    const result = await runPipeline(db(), {
      ...(imageBase64 ? { imageBase64 } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(storedFeatures ? { features: storedFeatures } : {}),
      ...(storedPixels ? { pixels: storedPixels } : {}),
      ...(body.productCode ? { forcedProductCode: body.productCode } : {}),
      farm,
      farmerName: user.name,
    });

    if (storedId) {
      updateAnalysis(storedId, result);
    } else {
      const stored = putAnalysis({
        userId: user.id,
        imagePath,
        // LLM provider 재호출을 위해 잠시 보관(30분 TTL). 파일은 별도로 저장돼 있다.
        imageBase64,
        mimeType,
        features: storedFeatures,
        pixels: storedPixels,
        result,
      });
      storedId = stored.id;
    }

    ctx.json({ analysisId: storedId, imagePath, ...result });
  });
}
