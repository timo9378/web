/**
 * 「這篇文章要抓哪幾個語系」——`check-links` 與 `check-mdx` 共用。
 *
 * ## 為什麼要共用而不是各寫一份
 *
 * 這兩支腳本在**同一個 CI job 裡先後跑**，而且都是「逐篇 × 逐語系打自家 API」。
 * 原本各自寫了一份 `for (const lang of LOCALES)`，也各自寫著同一句註解
 * 「404 = 該語系無此文，是正常狀態」——它們都知道那些 404 是預期中的，卻都照撞不誤。
 *
 * 而那些 404 會讓**整個 runner 的 IP 被 CrowdSec 封鎖**（http-probing 情境就是在數
 * 404，預設 capacity 10 / leakspeed 10s）。被封之後是丟包不是回應，所以症狀是
 * 「連續 3 次逾時」，錯誤訊息完全指不出原因。
 *
 * 實測（2026-08-07）：先修好 check-links 之後那次 CI **還是紅**——因為 check-mdx
 * 先跑、先把 IP 撞封了，check-links 只跑了 29 筆就被切斷。nginx log 裡看得很清楚：
 * 同一個 IP 有兩次 `?limit=500`（兩支腳本各一次），14 個 404 全部落在第一次那輪。
 *
 * 只改一邊是這件事最自然的失敗方式，所以把判斷放這裡、兩邊都 import。
 */

/** '' = 原文（不帶 `?lang=`，對齊 blogList.ts 的 no-lang 行為） */
export const LOCALES = ['', 'zh-CN', 'en', 'ja', 'ko'] as const;

export interface PostWithLocales {
  id: number;
  /**
   * 這篇實際有哪幾個語系（例：`["zh-TW","zh-CN","en"]`）。清單端點本來就會回這一欄，
   * 第一個請求就拿得到——不必、也不該用「打打看會不會 404」的方式去問。
   */
  available_locales?: string[];
}

/**
 * 這篇要抓的語系清單，形式對齊 `LOCALES`（原文是空字串）。
 *
 * 沒有 `available_locales` 欄位時退回全部語系，維持舊行為：少抓會讓內容漏檢，
 * 而漏檢是這兩支腳本存在的反面。「欄位不存在」跟「這篇只有中文」是兩件事。
 */
export function localesOf(p: PostWithLocales): readonly string[] {
  if (!p.available_locales?.length) return LOCALES;
  // available_locales 用完整代碼（原文是 zh-TW），LOCALES 用空字串代表原文
  const has = new Set(p.available_locales);
  return LOCALES.filter((l) => (l === '' ? true : has.has(l)));
}
