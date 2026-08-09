import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, dbPath, uploadsDir } from '../config.js';

export type Db = DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));

function schemaSql(): string {
  return readFileSync(join(here, 'schema.sql'), 'utf8');
}

/**
 * DB 를 열고 스키마를 보장한다.
 * @param path ':memory:' 를 주면 테스트용 인메모리 DB.
 */
/**
 * 이미 만들어진 DB 에는 CREATE TABLE IF NOT EXISTS 가 새 컬럼을 더해주지 않는다.
 * 누락된 컬럼만 조용히 채운다(파괴적 변경 없음).
 */
function migrate(db: Db): void {
  const has = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (c) => c.name === column,
    );
  if (!has('users', 'hub_id')) db.exec('ALTER TABLE users ADD COLUMN hub_id INTEGER');
  if (!has('listings', 'confirmed_quality')) {
    db.exec('ALTER TABLE listings ADD COLUMN confirmed_quality TEXT');
  }
}

export function openDb(path: string = dbPath()): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schemaSql());
  migrate(db);
  return db;
}

let singleton: Db | null = null;

/** 서버 전역에서 쓰는 DB 핸들. */
export function db(): Db {
  if (!singleton) {
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(uploadsDir(), { recursive: true });
    singleton = openDb();
  }
  return singleton;
}

export function closeDb(): void {
  singleton?.close();
  singleton = null;
}

/* ────────────────────────────────────────────────────────────
   node:sqlite 는 unknown 을 돌려주므로 얇은 타입 헬퍼를 둔다.
   ──────────────────────────────────────────────────────────── */

export function one<T>(db: Db, sql: string, ...params: SqlParam[]): T | null {
  const row = db.prepare(sql).get(...(params as never[]));
  return (row as T | undefined) ?? null;
}

export function all<T>(db: Db, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function run(
  db: Db,
  sql: string,
  ...params: SqlParam[]
): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(...(params as never[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export type SqlParam = string | number | null | Uint8Array;

/** 간단한 트랜잭션 헬퍼. 예외가 나면 롤백한다. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 이미 롤백된 경우 무시 */
    }
    throw err;
  }
}
