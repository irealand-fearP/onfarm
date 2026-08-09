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
  result: PipelineResult;
  createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, StoredAnalysis>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, item] of store) {
    if (item.createdAt < cutoff) store.delete(id);
  }
}

/**
 * 분석 결과를 잠시 보관한다.
 * 상품 등록 시 클라이언트가 보낸 가격·품목을 믿지 않고 여기 저장된 결과를 근거로 삼는다.
 * (프로세스 메모리라 서버 재시작 시 사라진다 — 단일 프로세스 MVP 전제)
 */
export function putAnalysis(
  input: Omit<StoredAnalysis, 'id' | 'createdAt'>,
): StoredAnalysis {
  sweep();
  const item: StoredAnalysis = { ...input, id: randomUUID(), createdAt: Date.now() };
  store.set(item.id, item);
  return item;
}

export function getAnalysis(id: string, userId: number): StoredAnalysis | null {
  sweep();
  const item = store.get(id);
  if (!item) return null;
  if (item.userId !== userId) return null;
  return item;
}

export function updateAnalysis(id: string, result: PipelineResult): void {
  const item = store.get(id);
  if (item) item.result = result;
}

export function clearAnalyses(): void {
  store.clear();
}
