/*
  사진에서 색·질감 특징을 뽑는다.

  왜 브라우저에서 하나:
   - 외부 API 키가 없어도 품목 후보를 좁힐 수 있어야 하고(오프라인 동작),
   - 원본 사진을 서버·외부로 크게 보내지 않고도 신호를 만들 수 있기 때문.
  이 값들은 '판정'이 아니라 판정의 입력이다. 최종 등급은 거점 실물 검수가 정한다.
*/

const UPLOAD_MAX_SIDE = 1024;
const ANALYZE_MAX_SIDE = 256;

function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

async function toBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 일부 브라우저는 옵션 미지원 */
    }
    try {
      return await createImageBitmap(file);
    } catch {
      /* 아래 폴백 */
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열지 못했습니다.'));
    img.src = URL.createObjectURL(file);
  });
}

function drawScaled(source, maxSide) {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

/** 색상 히스토그램 칸 수. 15도 단위 — 배(55°)·양파(42°)·감자(38°)를 구분하려면 30도로는 부족하다. */
export const HUE_BINS = 24;

export function extractFeatures(imageData, width, height) {
  const data = imageData.data;
  const bins = HUE_BINS;
  const histogram = new Array(bins).fill(0);
  let sumS = 0;
  let sumV = 0;
  let colorWeight = 0;
  const luma = new Float32Array(width * height);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy) || 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      luma[y * width + x] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const { h, s, v } = rgbToHsv(r, g, b);
      // 가운데에 피사체가 있을 확률이 높아 중심을 더 신뢰한다.
      const radial = 1 - 0.6 * (Math.hypot(x - cx, y - cy) / maxDist);
      // 채도를 제곱해서 가중한다: 나무 상자·시멘트 바닥·흰 천 같은 저채도 배경이
      // 피사체만큼 표를 행사하던 문제를 줄인다.
      const weight = s * s * v * radial;
      histogram[Math.min(bins - 1, Math.floor(h / (360 / bins)))] += weight;

      // 채도·명도 평균은 '색이 있는 픽셀'에서만 낸다(배경 희석 방지).
      if (v > 0.15 && s > 0.15) {
        sumS += s * radial;
        sumV += v * radial;
        colorWeight += radial;
      }
    }
  }

  const total = histogram.reduce((a, b) => a + b, 0) || 1;
  const normalized = histogram.map((v) => v / total);

  // 인접 칸 묶음(약 75도)의 최대 비중 → 색이 한 곳에 몰려 있는 정도
  const windowSize = Math.max(3, Math.round(bins * 0.2));
  const half = Math.floor(windowSize / 2);
  let bestWindow = 0;
  for (let i = 0; i < bins; i += 1) {
    let share = 0;
    for (let k = -half; k <= half; k += 1) share += normalized[(i + k + bins) % bins];
    if (share > bestWindow) bestWindow = share;
  }
  const baseline = windowSize / bins;
  const hueConcentration = Math.max(0, Math.min(1, (bestWindow - baseline) / (1 - baseline)));

  let diffSum = 0;
  let diffCount = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const p = luma[y * width + x];
      diffSum += Math.abs(p - luma[y * width + x + 1]);
      diffSum += Math.abs(p - luma[(y + 1) * width + x]);
      diffCount += 2;
    }
  }
  const avgDiff = diffCount ? diffSum / diffCount : 0;

  return {
    width,
    height,
    hueHistogram: normalized,
    meanSaturation: colorWeight ? sumS / colorWeight : 0,
    meanValue: colorWeight ? sumV / colorWeight : 0,
    edgeDensity: Math.max(0, Math.min(1, avgDiff / 0.18)),
    hueConcentration,
  };
}

/**
 * 파일 하나를 받아 업로드용 dataURL 과 분석용 특징을 만든다.
 * @returns {Promise<{dataUrl:string, features:object, width:number, height:number}>}
 */
export async function prepareImage(file) {
  const bitmap = await toBitmap(file);
  const big = drawScaled(bitmap, UPLOAD_MAX_SIDE);
  const dataUrl = big.canvas.toDataURL('image/jpeg', 0.82);

  const small = drawScaled(bitmap, ANALYZE_MAX_SIDE);
  const imageData = small.ctx.getImageData(0, 0, small.w, small.h);
  const features = extractFeatures(imageData, small.w, small.h);

  if (bitmap.close) bitmap.close();
  return { dataUrl, features, width: big.w, height: big.h };
}
