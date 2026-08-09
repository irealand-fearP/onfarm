import { existsSync, rmSync } from 'node:fs';
import { dbPath } from '../config.js';
import { closeDb, db } from './index.js';
import { seed } from './seed.js';

const reset = process.argv.includes('--reset');
const path = dbPath();

if (reset && existsSync(path)) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${path}${suffix}`;
    if (existsSync(f)) rmSync(f);
  }
  console.log(`[seed] 기존 DB 삭제: ${path}`);
}

const handle = db();
seed(handle);
const counts = ['products', 'skus', 'users', 'farms', 'hubs', 'listings'].map((t) => {
  const row = handle.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
  return `${t}=${row.c}`;
});
closeDb();
console.log(`[seed] 완료: ${counts.join(', ')}`);
console.log(`[seed] DB 위치: ${path}`);
