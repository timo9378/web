// 後端 admin REST API 的薄客戶端：登入拿 JWT、快取、401 自動重登一次。
// 憑證從環境變數來（見 index.ts），token 只存在記憶體、不落地。

export interface ApiConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  /** 預先簽好的 JWT（可選；設了就跳過 username/password 登入流程）。 */
  token?: string;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  /** 預設 true（帶 Bearer）。公開端點（health/vitals）設 false。 */
  auth?: boolean;
}

export class ApiClient {
  private token?: string;

  constructor(private cfg: ApiConfig) {
    this.token = cfg.token;
  }

  private async login(): Promise<string> {
    if (!this.cfg.username || !this.cfg.password) {
      throw new Error(
        '缺少後台憑證：請設定 KOIMSURAI_ADMIN_USERNAME + KOIMSURAI_ADMIN_PASSWORD（或直接給 KOIMSURAI_ADMIN_TOKEN）',
      );
    }
    const res = await fetch(`${this.cfg.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    if (!res.ok) {
      throw new Error(`後台登入失敗 (${res.status})——檢查帳密與後端是否在 ${this.cfg.baseUrl}`);
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error('登入回應缺少 token');
    this.token = data.token;
    return this.token;
  }

  private async ensureToken(): Promise<string> {
    return this.token ?? this.login();
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { query, body, auth = true } = opts;
    const url = new URL(`${this.cfg.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const send = (bearer?: string): Promise<Response> =>
      fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

    let res: Response;
    if (auth) {
      res = await send(await this.ensureToken());
      // token 過期 / 失效 → 清掉重登一次（僅在有帳密時）
      if (res.status === 401 && this.cfg.username && this.cfg.password) {
        this.token = undefined;
        res = await send(await this.login());
      }
    } else {
      res = await send();
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object'
          ? ((parsed as Record<string, unknown>).error ?? (parsed as Record<string, unknown>).message ?? text)
          : text || res.statusText;
      throw new Error(`${method} ${path} → ${res.status}: ${String(msg)}`);
    }
    return parsed as T;
  }

  /** 上傳檔案（multipart/form-data，欄位名 file——對齊後端 multer.single('file')）。
   *  Bearer 認證 + 401 自動清 token 重登一次。FormData 每次 send 重建（body 只能消費一次）。 */
  async uploadFile<T = unknown>(path: string, bytes: Uint8Array, filename: string, contentType?: string): Promise<T> {
    const send = (bearer: string): Promise<Response> => {
      const form = new FormData();
      // @types/node 26 起 Uint8Array 泛型化為 Uint8Array<ArrayBufferLike>;Blob/BlobPart 要
      // Uint8Array<ArrayBuffer>。bytes 為上傳檔案資料（fs/網路,非 SharedArrayBuffer）→ 收斂型別安全。
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], contentType ? { type: contentType } : {});
      form.append('file', blob, filename);
      // 不手動設 content-type：讓 fetch 自動帶 multipart boundary。
      return fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}` },
        body: form,
      });
    };

    let res = await send(await this.ensureToken());
    if (res.status === 401 && this.cfg.username && this.cfg.password) {
      this.token = undefined;
      res = await send(await this.login());
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object'
          ? ((parsed as Record<string, unknown>).error ?? (parsed as Record<string, unknown>).message ?? text)
          : text || res.statusText;
      throw new Error(`POST ${path} → ${res.status}: ${String(msg)}`);
    }
    return parsed as T;
  }
}
