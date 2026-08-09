import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** dist/config.js 기준으로 프로젝트 루트를 찾는다. */
const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, '..');

/** .env 를 아주 얇게 읽는다(외부 의존성 없이). 이미 설정된 process.env 가 우선한다. */
function loadDotEnv(): void {
  const file = join(PROJECT_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

export type AiProviderName = 'heuristic' | 'openai' | 'anthropic' | 'mock' | 'cnn';

const PROVIDER_NAMES: AiProviderName[] = ['heuristic', 'openai', 'anthropic', 'mock', 'cnn'];

function providerName(): AiProviderName {
  const raw = (process.env['AI_PROVIDER'] ?? 'heuristic').toLowerCase();
  return (PROVIDER_NAMES as string[]).includes(raw) ? (raw as AiProviderName) : 'heuristic';
}

export const config = {
  port: Number(process.env['PORT'] ?? 4173),
  host: process.env['HOST'] ?? '127.0.0.1',
  sessionSecret: process.env['SESSION_SECRET'] ?? 'onfarm-dev-secret-change-me',
  dataDir: process.env['DATA_DIR'] ?? join(PROJECT_ROOT, 'data'),
  publicDir: join(PROJECT_ROOT, 'public'),
  ai: {
    provider: providerName(),
    timeoutMs: Number(process.env['AI_TIMEOUT_MS'] ?? 12_000),
    writer: (process.env['AI_WRITER'] ?? 'template').toLowerCase(),
    openaiKey: process.env['OPENAI_API_KEY'] ?? '',
    openaiModel: process.env['OPENAI_VISION_MODEL'] ?? 'gpt-4o-mini',
    anthropicKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    anthropicModel: process.env['ANTHROPIC_VISION_MODEL'] ?? 'claude-sonnet-5',
    /** onfarm_qc.onnx 와 metadata.json 이 있는 폴더 (AI_PROVIDER=cnn 일 때) */
    cnnModelDir: process.env['CNN_MODEL_DIR'] ?? join(PROJECT_ROOT, 'models'),
  },
} as const;

export function uploadsDir(): string {
  return join(config.dataDir, 'uploads');
}

export function dbPath(): string {
  return process.env['DB_PATH'] ?? join(config.dataDir, 'onfarm.db');
}
