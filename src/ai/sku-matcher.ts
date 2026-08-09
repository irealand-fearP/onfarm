import { all, one } from '../db/index.js';
import type { Db } from '../db/index.js';
import type { Product, Sku } from '../domain/types.js';

export interface SkuCandidate extends Sku {
  product_code: string;
  product_name: string;
}

/**
 * 인식된 품목 코드를 '운영자가 미리 등록한 표준 SKU' 로 연결한다.
 * AI 는 여기서 가격을 만들지 않는다. 가격은 DB 의 skus.price 가 유일한 출처다.
 */
export function matchSkus(db: Db, productCode: string): SkuCandidate[] {
  if (!productCode) return [];
  return all<SkuCandidate>(
    db,
    `SELECT s.*, p.code AS product_code, p.name_ko AS product_name
       FROM skus s
       JOIN products p ON p.id = s.product_id
      WHERE p.code = ? AND s.active = 1 AND p.active = 1
      ORDER BY s.is_default DESC, s.weight ASC`,
    productCode,
  );
}

export function defaultSku(db: Db, productCode: string): SkuCandidate | null {
  return matchSkus(db, productCode)[0] ?? null;
}

export function findProductByCode(db: Db, code: string): Product | null {
  return one<Product>(db, 'SELECT * FROM products WHERE code = ? AND active = 1', code);
}

export function findSkuById(db: Db, id: number): SkuCandidate | null {
  return one<SkuCandidate>(
    db,
    `SELECT s.*, p.code AS product_code, p.name_ko AS product_name
       FROM skus s JOIN products p ON p.id = s.product_id
      WHERE s.id = ? AND s.active = 1`,
    id,
  );
}

export function catalog(db: Db): Product[] {
  return all<Product>(db, 'SELECT * FROM products WHERE active = 1 ORDER BY id');
}
