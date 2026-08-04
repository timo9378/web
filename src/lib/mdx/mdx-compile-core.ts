// MDX 編譯的**唯一**一份設定——實作已經搬到 `@koimsurai/mdx-core`。
//
// 為什麼要搬到 workspace 套件：這個檔原本的註解寫著「如果那支腳本自己抄一份選項，
// 日後有人在這裡加 plugin，檢查器會用舊的那組編 —— 過了也不代表線上過」。
// 而 `packages/mcp-server/src/validate.ts` 正是又抄了一份（它是獨立套件，
// rootDir 讓它 import 不到這裡）。搬進共用套件之後三邊必然是同一份。
//
// 這個檔留著只為了讓前端側的入口名字不變，內容就是轉呼叫。

import { compileMdxToHastJson } from '@koimsurai/mdx-core';

/**
 * MDX 原始碼 → 送給前端的 JSON（序列化的 hast 樹）。
 *
 * ⚠️ 回傳值的**意義變了**（以前是 `function-body` 的 JS 字串，前端用 `runSync` 執行），
 * 但型別仍然是 `string`——所以 `PostDetail.compiledMdx`、dehydrate、query 快取
 * 全都不必動。換掉的理由見 `@koimsurai/mdx-core` 的檔頭：`runSync` 底層是
 * `new Function`，需要 CSP 的 `'unsafe-eval'`。
 */
export async function compileMdxSource(source: string): Promise<string> {
  return compileMdxToHastJson(source);
}
