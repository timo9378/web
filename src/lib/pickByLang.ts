/**
 * 依語言取表格內容，取不到就回退。
 *
 * 為什麼要一個 helper：站上十幾處寫成 `TABLE[lang] || TABLE['zh-TW']`，
 * 那個 `||` 執行期是必要的（lang 是 i18next 給的字串，表格不保證每個語系都有），
 * 但型別上是「多餘」的 —— 沒開 noUncheckedIndexedAccess 時
 * `Record<string, T>[k]` 的型別是 `T` 而不是 `T | undefined`，
 * 於是 no-unnecessary-condition 每一處都報一次。
 *
 * 全域開 noUncheckedIndexedAccess 要付 200+ 個 tsc error（多數是索引明明在範圍內的
 * 迴圈），代價和收益不成比例。改成把這個型別落差集中在這裡一次講清楚：
 * 對外的簽章是誠實的（回傳 T，因為 fallback 一定給得出值），
 * 內部那一道 `Partial<...>` 斷言是「索引存取其實可能落空」的唯一宣告點。
 */
export function pickByLang<T>(table: Record<string, T>, lang: string, fallback: T): T {
  return (table as Partial<Record<string, T>>)[lang] ?? fallback;
}
