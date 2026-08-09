import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uploadsDir } from '../config.js';
import { HttpError } from './http.js';

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MAX_BYTES = 8 * 1024 * 1024;

export interface ParsedImage {
  base64: string;
  mimeType: string;
  bytes: number;
}

/** data:image/jpeg;base64,... 형태를 검증해서 분해한다. */
export function parseDataUrl(dataUrl: string): ParsedImage {
  const m = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m || !m[1] || !m[2]) throw new HttpError(400, '이미지 형식을 읽을 수 없습니다.', 'bad_image');
  const mimeType = m[1].toLowerCase();
  if (!ALLOWED[mimeType]) throw new HttpError(415, '지원하지 않는 이미지 형식입니다.', 'bad_image');
  const base64 = m[2];
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) throw new HttpError(413, '사진 용량이 너무 큽니다.', 'too_large');
  return { base64, mimeType, bytes };
}

export interface SavedImage {
  /** 브라우저에서 접근하는 경로 (/uploads/xxx.jpg) */
  publicPath: string;
  absolutePath: string;
}

export function saveImage(image: ParsedImage): SavedImage {
  const dir = uploadsDir();
  mkdirSync(dir, { recursive: true });
  const ext = ALLOWED[image.mimeType] ?? '.jpg';
  const name = `${randomUUID()}${ext}`;
  const absolutePath = join(dir, name);
  writeFileSync(absolutePath, Buffer.from(image.base64, 'base64'));
  return { publicPath: `/uploads/${name}`, absolutePath };
}
