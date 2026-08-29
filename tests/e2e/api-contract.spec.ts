import { Validator } from '@cfworker/json-schema';
import { expect, test } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

import { E2E_POST_PREFIX, PUBLISHED_POSTS } from './seed.mjs';

/**
 * 前後端契約：**拿後端自己發布的 OpenAPI schema 去驗它自己的回應**，不手寫欄位斷言。
 *
 * 為什麼這樣做：
 *   - schema 是 utoipa 從同一批 struct 生的（跟 specta 給前端的 TS 型別同源），
 *     所以「回應符合 schema」等於「回應符合前端拿到的型別」。
 *   - 手寫 `expect(typeof x.foo).toBe('number')` 只涵蓋當下想到的欄位，
 *     而且新端點不會自動被測到。schema 驗證是整包比對，新端點加進 spec 就自動納入。
 *   - CI 已經有 specta drift gate 擋「struct 改了但 index.ts 沒重生」，
 *     但沒有東西擋「宣告的形狀跟實際回的不一樣」。這支補的是那個縫。
 *
 * 只驗**無參數的公開 GET**：帶參數的要準備 fixture、寫入型的有副作用，
 * 那些交給下面幾支明確的測試與 backend 的整合測試。
 *
 * ⚠️ 驗證器用 @cfworker/json-schema 而不是 ajv，有兩個理由：
 *   1. utoipa 產的是 OpenAPI **3.1**（＝JSON Schema draft 2020-12），ajv 6 不支援
 *   2. pnpm-workspace.yaml 有一條 CVE 用的 top-level override 把 ajv 壓在 ^6.14.0，
 *      直接相依 ajv@8 會讓 --frozen-lockfile 對不起來（CI 實測擋下來過）。
 *      那條 pin 是刻意的，不該為了測試去動它。
 */

interface OpenApiOperation {
  security?: Record<string, unknown>[];
  parameters?: { required?: boolean; in: string }[];
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}
type OpenApiSpec = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
};

let spec: OpenApiSpec;

test.beforeAll(async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  spec = (await (await ctx.get('/api/openapi.json')).json()) as OpenApiSpec;
  await ctx.dispose();
});

/**
 * 把 operation 的 schema 包成一份自足的文件：spec 裡的 $ref 都是
 * `#/components/schemas/X`（相對於文件根），所以要把 components 一起帶進來才解得開。
 * 2020-12 起 `$ref` 不再蓋掉同層的其他關鍵字，所以就算 opSchema 本身是個 $ref 也成立。
 */
const validatorFor = (opSchema: unknown) =>
  new Validator({ ...(opSchema as object), components: spec.components } as never, '2020-12');

/** 挑「不用準備任何東西就能打」的公開 GET。 */
function plainPublicGets(): { path: string; schema: unknown }[] {
  const out: { path: string; schema: unknown }[] = [];
  for (const [p, ops] of Object.entries(spec.paths)) {
    const op = ops.get;
    if (!op) continue;
    if (op.security?.some((s) => 'bearer' in s)) continue; // 要 token
    if (p.includes('{')) continue; // 帶路徑參數
    if (op.parameters?.some((x) => x.required && x.in === 'query')) continue; // 必填 query
    const schema = op.responses?.['200']?.content?.['application/json']?.schema;
    if (schema) out.push({ path: p, schema });
  }
  return out;
}

test('公開 GET 端點的回應都符合自己宣告的 OpenAPI schema', async ({ request }) => {
  const targets = plainPublicGets();
  expect(targets.length, 'spec 裡應該找得到一批無參數的公開 GET').toBeGreaterThan(8);

  const bad: string[] = [];
  for (const { path, schema } of targets) {
    const r = await request.get(path, { failOnStatusCode: false });
    // 第三方端點沒金鑰會走降級路徑（另有測試驗），這裡只驗成功回應的形狀
    if (r.status() !== 200) continue;
    const body: unknown = await r.json();
    const result = validatorFor(schema).validate(body);
    if (!result.valid) {
      const errs = result.errors
        .slice(0, 3)
        .map((e) => `${e.instanceLocation} ${e.error}`)
        .join('; ');
      bad.push(`${path} — ${errs}`);
    }
  }
  expect(bad, '這些端點回的東西跟自己宣告的 schema 對不上').toEqual([]);
});

/**
 * 守衛清單也從 spec 自動列舉：凡是宣告要 bearer 的，沒帶 token 就必須 401。
 * 手寫清單只涵蓋寫的時候想到的，新端點忘了掛守衛不會有人發現。
 * （反過來的漏洞——該掛卻連 spec 都沒宣告——這裡擋不到，那要靠 review。）
 */
test('凡是 OpenAPI 宣告要 bearer 的端點，沒帶 token 都不能給資料', async ({ request }) => {
  const guarded: { method: string; path: string }[] = [];
  for (const [rawPath, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!op.security?.some((s) => 'bearer' in s)) continue;
      // {id} 換成一定不存在的值：守衛必須在查資料之前，所以就算 id 不存在也該 401 而非 404
      guarded.push({ method: method.toUpperCase(), path: rawPath.replace(/\{[^}]+\}/g, '999999') });
    }
  }
  expect(guarded.length, 'spec 裡應該要有一批 bearer 端點').toBeGreaterThan(10);

  const leaked: string[] = [];
  for (const { method, path } of guarded) {
    // 一定要帶合法 JSON body：axum 的 Json extractor 在 handler 之前就跑，
    // 沒 Content-Type 會直接 415，那條路**碰不到 require_admin**，等於沒測到守衛。
    const r = await request.fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      data: {},
      failOnStatusCode: false,
    });
    if (r.status() !== 401) leaked.push(`${method} ${path} → ${r.status()}`);
  }
  expect(leaked, '這些宣告要驗證的端點，沒帶 token 時沒有回 401').toEqual([]);
});

/**
 * 降級路徑：CI 沒有第三方金鑰，這些端點會走「未配置」那條。
 * 平常沒人走的路最容易壞掉又沒人發現，所以特別釘住它的形狀。
 */
const DEGRADED = [
  { path: '/api/steam/player', arrays: [] as string[] },
  { path: '/api/steam/recent-games', arrays: ['games'] },
  { path: '/api/steam/owned-games', arrays: ['games'] },
  { path: '/api/wakatime/today', arrays: [] },
  { path: '/api/wakatime/week', arrays: ['languages', 'projects'] },
  { path: '/api/github/repos/octocat', arrays: ['repos'] },
  { path: '/api/github/contributions/octocat', arrays: ['contributions'] },
  { path: '/api/github/events/octocat', arrays: ['events'] },
];

for (const ep of DEGRADED) {
  test(`${ep.path} 沒金鑰時形狀仍完整`, async ({ request }) => {
    const r = await request.get(ep.path, { failOnStatusCode: false });
    const b = (await r.json()) as Record<string, unknown>;
    // 陣列欄位一定要存在（前端直接 .map，不能是 undefined）——降級路徑最常壞在這
    for (const k of ep.arrays) expect(Array.isArray(b[k]), `${ep.path} 的 ${k} 應為陣列`).toBe(true);
    expect(b.error === null || typeof b.error === 'string', `${ep.path} 的 error 應為 string | null`).toBe(true);
    // 5xx 只在「刻意降級」時可接受，而且要說明白是什麼事；沒有 error 的 5xx 就是真的爆了
    if (r.status() >= 500) expect(typeof b.error, `${ep.path} 回 ${r.status()} 卻沒說原因`).toBe('string');
  });
}

// ── 以下是 schema 驗不到的「意圖」，只能手寫 ────────────────────────────
// schema 說得出「posts 是陣列」，說不出「草稿不該在裡面」。

const json = async (request: APIRequestContext, path: string) => (await request.get(path)).json();

test('公開清單只回已發布的文章', async ({ request }) => {
  const b = await json(request, '/api/posts');
  const titles: string[] = b.posts.map((p: { title: string }) => p.title);
  expect(titles).not.toContain('未發布草稿');
  // 張數從 seed 那邊 import，不寫死——seed 因為別的需求增減文章時（例如 CLS 測試
  // 用的長文），不該連帶讓這個不相干的斷言變紅。
  //
  // 排掉 post-editor.spec.ts 建的那些：它有一條「發佈之後讀者看得到」會真的發一篇文章，
  // 而跨檔是平行跑的——不排掉的話這條斷言會依執行順序**間歇性**變紅，
  // 那種紅比沒有斷言更糟。前綴是兩邊的約定（E2E_POST_PREFIX），改要一起改。
  const seeded = titles.filter((t) => !t.startsWith(E2E_POST_PREFIX));
  expect(seeded.length).toBe(PUBLISHED_POSTS);
});

test('留言只回審核通過的', async ({ request }) => {
  const b = await json(request, '/api/posts/1/comments');
  const authors = b.comments.map((c: { author: string }) => c.author);
  expect(authors).toContain('路過的讀者');
  expect(authors, '待審核的不該公開').not.toContain('待審核的人');
});

test('碎念的 ref 解得出物件，原字串也還在', async ({ request }) => {
  const b = await json(request, '/api/thoughts');
  const withRef = b.thoughts.find((t: { ref_type: string | null }) => t.ref_type === 'link');
  expect(withRef.ref.title).toBe('範例連結');
  expect(withRef.ref.poster, 'media 那組欄位補成 null，而不是整筆解析失敗').toBeNull();
  expect(typeof withRef.ref_json).toBe('string');
});

test('相簿 manifest 的整數不會變成浮點', async ({ request }) => {
  const b = await json(request, '/api/gallery/photos');
  expect(b.totalPhotos).toBe(b.photos.length);
  const iso = b.photos
    .map((x: { exif?: { ISO?: unknown } }) => x.exif?.ISO)
    .find((v: unknown) => typeof v === 'number');
  if (iso !== undefined) expect(Number.isInteger(iso), 'manifest 會被反覆讀寫，序列化不該改數字寫法').toBe(true);
});

test('不存在的資源回 404', async ({ request }) => {
  for (const p of ['/api/posts/99999', '/api/thoughts/99999']) {
    expect((await request.get(p, { failOnStatusCode: false })).status(), p).toBe(404);
  }
});
