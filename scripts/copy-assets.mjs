// tsc 는 .sql 같은 비-TS 자산을 옮기지 않는다. 빌드 후 dist 로 복사한다.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outDir = join(root, 'dist');

let copied = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith('.sql')) continue;
    const target = join(outDir, relative(srcDir, full));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(full, target);
    copied += 1;
  }
}

if (existsSync(srcDir)) walk(srcDir);
console.log(`[copy-assets] ${copied} asset file(s) copied to dist/`);
