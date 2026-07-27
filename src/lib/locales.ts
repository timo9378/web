// 純資料的語系常數 + 路徑組裝。
//
// 為什麼獨立成一支：Nitro 的 server route（server/routes/sitemap.xml.ts）也需要這組對應表，
// 但 start-i18n.tsx 在 top-level import 了 React、i18next 與五份語系 JSON——server route 只是
// 要組幾個網址，不該為此把整個 i18n runtime 拉進 bundle。start-i18n 從這裡 re-export，
// 兩邊共用同一份定義，不會漂移。

export const SUPPORTED_LOCALES = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-TW';

// 預設 zh-TW 不帶前綴(保留既有已索引 URL),其餘用小寫前綴。
export const LOCALE_PREFIX: Record<Locale, string> = {
  'zh-TW': '',
  'zh-CN': 'zh-cn',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
};

/** 某 locale 下、某邏輯路徑(無前綴,如 '' 或 'blog/39')的絕對路徑(開頭有 /)。 */
export function localePathname(locale: Locale, basePath = ''): string {
  const segs = [LOCALE_PREFIX[locale], basePath.replace(/^\/+/, '')].filter(Boolean).join('/');
  return segs ? `/${segs}` : '/';
}
