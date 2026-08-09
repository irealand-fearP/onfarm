import { randomUUID } from 'node:crypto';
import type { PipelineResult } from '../ai/pipeline.js';
import type { ImageFeatures } from '../ai/types.js';

export interface StoredAnalysis {
  id: string;
  userId: number;
  imagePath: string | null;
  imageBase64: string | null;
  mimeType: string | null;
  features: ImageFeatures | null;
  /** 학습 모델 입력용 224×224 RGB. 폴백 재분석 때 다시 쓴다. */
  pixels: Uint8Array | null;
  result: PipelineResult;
  createdAt: number;
  /** 상품 등록에 이미 쓰였는가. 한 번 쓰면 재사용할 수 없다. */
  consumed: boolean;
}

const TTL_MS = 30 * 60 * 1000;
/** 한 사용자가 동시에 들고 있을 수 있는 분석 수. 초과하면 오래된 것부터 버린다. */
const MAX_PER_USER = 12;
const store = new Map<string, StoredAnalysis>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, item] of store) {
    if (item.createdAt < cutoff) store.delete(id);
  }
}

/** 사용자별 보관량 상한 — 반복 업로드로 메모리가 무한히 늘지 않게 한다. */
function trimUser(userId: number): void {
  const mine = [...store.values()]
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > MAX_PER_USER) {
    const oldest = mine.shift();
    if (oldest) store.delete(oldest.id);
  }
}

/**
 * 분석 결과를 잠시 보관한다.
 * 상품 등록 시 클라이언트가 보낸 가격·품목을 믿지 않고 여기 저장된 결과를 근거로 삼는다.
 * (프로세스 메모리라 서버 재시작 시 사라진다 — 단일 프로세스 MVP 전제)
 */
export function putAnalysis(
  input: Omit<StoredAnalysis, 'id' | 'createdAt' | 'consumed'>,
): StoredAnalysis {
  sweep();
  const item: StoredAnalysis = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    consumed: false,
  };
  store.set(item.id, item);
  trimUser(item.userId);
  return item;
}

/** 소진 여부와 무관하게 조회한다 — '만료'와 '이미 사용'을 구분해 안내하기 위함. */
export function findAnalysis(id: string, userId: number): StoredAnalysis | null {
  sweep();
  const item = store.get(id);
  if (!item) return null;
  if (item.userId !== userId) return null;
  return item;
}

export function getAnalysis(id: string, userId: number): StoredAnalysis | null {
  const item = findAnalysis(id, userId);
  if (!item || item.consumed) return null;
  return item;
}

/**
 * 등록에 쓴 분석을 즉시 소진 처리한다.
 * 응답 유실 후 재시도나 동시 요청으로 같은 사진이 두 개의 매물이 되는 것을 막는다.
 * @returns 이번 호출이 실제로 소진에 성공했는지 (이미 쓰였으면 false)
 */
export function consumeAnalysis(id: string, userId: number): StoredAnalysis | null {
  const item = getAnalysis(id, userId);
  if (!item) return null;
  item.consumed = true;
  return item;
}

export function updateAnalysis(id: string, result: PipelineResult): void {
  const item = store.get(id);
  if (item) item.result = result;
}

/** 등록에 쓰이지 않고 만료된 사진 파일 경로들 — 청소 대상. */
export function expiredImagePaths(): string[] {
  const cutoff = Date.now() - TTL_MS;
  const paths: string[] = [];
  for (const item of store.values()) {
    if (item.createdAt < cutoff && !item.consumed && item.imagePath) paths.push(item.imagePath);
  }
  return paths;
}

export function clearAnalyses(): void {
  store.clear();
}
