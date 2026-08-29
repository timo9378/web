// 憑證解析：優先環境變數；缺了就退回讀 .env.backend（後端用的同一份密鑰檔）。
// 這讓在 server 上（Claude Code via VSCode remote SSH）零設定即可用——
// 不必把 env var 塞進 extension host。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Credentials {
  username?: string;
  password?: string;
  token?: string;
}

export function resolveCredentials(): Credentials {
  const fromEnv: Credentials = {
    username: process.env.KOIMSURAI_ADMIN_USERNAME || undefined,
    password: process.env.KOIMSURAI_ADMIN_PASSWORD || undefined,
    token: process.env.KOIMSURAI_ADMIN_TOKEN || undefined,
  };
  // 環境變數已足夠 → 直接用（env 永遠優先）
  if (fromEnv.token || (fromEnv.username && fromEnv.password)) return fromEnv;

  // 退回檔案：KOIMSURAI_ENV_FILE 指定，或專案根的 .env.backend（cwd = 專案根）
  const candidates = [process.env.KOIMSURAI_ENV_FILE, resolve(process.cwd(), '.env.backend')].filter((p): p is string =>
    Boolean(p),
  );

  for (const path of candidates) {
    const parsed = tryParseEnvFile(path);
    if (parsed) {
      return {
        username: fromEnv.username ?? parsed.ADMIN_USERNAME,
        password: fromEnv.password ?? parsed.ADMIN_PASSWORD,
        token: fromEnv.token,
      };
    }
  }
  return fromEnv;
}

/** 極簡 dotenv 解析：KEY=VALUE、忽略註解/空行、去掉包裹引號。找不到檔回 null。 */
function tryParseEnvFile(path: string): Record<string, string> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}
