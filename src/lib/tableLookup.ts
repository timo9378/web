/**
 * 用執行期字串當 key 去查常數表。
 *
 * 為什麼需要這兩個函式：站上很多表宣告成 `Record<string, T>`，但 key 是執行期才知道的
 * 字串（i18next 的 lang、DB 來的 status/role、URL 的 locale）——表不保證每個 key 都有。
 * 沒開 noUncheckedIndexedAccess 時 `Record<string, T>[k]` 的型別是 `T` 而不是 `T | undefined`，
 * 於是呼叫端寫的 `|| fallback`、`?.` 在型別上全都「多餘」，no-unnecessary-condition 每處都報，
 * 但拿掉就會在查不到時炸掉。
 *
 * 全域開 noUncheckedIndexedAccess 要付 200+ 個 tsc error（多數是索引明明在範圍內的迴圈），
 * 代價與收益不成比例。改成把這個型別落差集中在這裡講一次：
 * 對外的簽章是誠實的，內部那一道 `Partial<...>` 斷言是「索引存取其實可能落空」的唯一宣告點。
 */

/** 查表；查不到回 undefined（呼叫端自己決定怎麼處理）。 */
export function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return (table as Partial<Record<string, T>>)[key];
}

/** 查表；查不到回 fallback。fallback 由呼叫端給，所以回傳型別一定是 T。 */
export function lookupOr<T>(table: Record<string, T>, key: string, fallback: T): T {
  return lookup(table, key) ?? fallback;
}
