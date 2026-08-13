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

/**
 * 실제 파일 앞머리(매직 넘버)가 선언한 형식과 맞는지 본다.
 * 선언 MIME 만 믿으면 아무 바이트나 .jpg 로 저장돼 소비자 화면에 깨진 이미지가 걸린다.
 */
function sniff(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** data:image/jpeg;base64,... 형태를 검증해서 분해한다. */
export function parseDataUrl(dataUrl: unknown): ParsedImage {
  if (typeof dataUrl !== 'string') {
    throw new HttpError(400, '이미지 형식을 읽을 수 없습니다.', 'bad_image');
  }
  const m = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m || !m[1] || !m[2]) throw new HttpError(400, '이미지 형식을 읽을 수 없습니다.', 'bad_image');
  const mimeType = m[1].toLowerCase();
  if (!ALLOWED[mimeType]) throw new HttpError(415, '지원하지 않는 이미지 형식입니다.', 'bad_image');
  const base64 = m[2].replace(/\s+/g, '');
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > MAX_BYTES) throw new HttpError(413, '사진 용량이 너무 큽니다.', 'too_large');

  const head = Buffer.from(base64.slice(0, 32), 'base64');
  const actual = sniff(head);
  if (!actual) throw new HttpError(415, '사진 파일이 아닙니다.', 'bad_image');
  // 선언과 실제가 달라도 실제 형식을 따른다(확장자·Content-Type 은 실제 바이트 기준).
  return { base64, mimeType: actual, bytes };
}

export interface SavedImage {
  /** 브라우저에서 접근하는 경로 (/uploads/xxx.jpg) */
  publicPath: string;
  absolutePath: string;
}

/** 시연용 사진으로 올린 파일에 붙는 접두사. 소비자 화면이 이 이름만 보고 배지를 붙인다. */
export const DEMO_PREFIX = 'demo-';

export function saveImage(image: ParsedImage, options: { demo?: boolean } = {}): SavedImage {
  const dir = uploadsDir();
  mkdirSync(dir, { recursive: true });
  const ext = ALLOWED[image.mimeType] ?? '.jpg';
  // 시연용은 파일명에 표식을 남긴다. DB 컬럼·API 형식을 건드리지 않고 구분하기 위함.
  const name = `${options.demo ? DEMO_PREFIX : ''}${randomUUID()}${ext}`;
  const absolutePath = join(dir, name);
  writeFileSync(absolutePath, Buffer.from(image.base64, 'base64'));
  return { publicPath: `/uploads/${name}`, absolutePath };
}
