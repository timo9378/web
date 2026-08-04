import { useNavigate, useRouterState } from '@tanstack/react-router';
import { localeFromPathname } from '@/i18n/start-i18n';
import { LOCALE_PREFIX, type Locale } from '@/lib/locales';

// 從 locale-link.tsx 拆出來：那支檔案同時 export 元件（LocaleLink）與這三個
// 非元件，會讓 Vite Fast Refresh 對整支檔案退回整頁重載
// （react-refresh only-export-components）。元件留在原處（22 個檔案 import 它），
// 搬走較少人用的這三個，改動面最小。

/** 目前路由的 locale（由 URL pathname 推得）。 */
export function useLocale(): Locale {
  return useRouterState({ select: (s) => localeFromPathname(s.location.pathname) });
}

/** 把「無前綴邏輯路徑」（如 '/about'）加上目前 locale 前綴 → '/en/about'；預設語言不加。 */
export function localizedPath(to: string, locale: Locale): string {
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return to; // 預設 zh-TW 無前綴
  return to === '/' ? `/${prefix}` : `/${prefix}${to}`;
}

/** locale-aware 程式化導航：navigate('/thinking') 會帶上目前 locale 前綴。
 * 用 href（官方逃生口）而非 to，才能吃帶 query/hash 的字串（如 /blog?category=X、/about#journey）。 */
export function useLocaleNavigate() {
  const navigate = useNavigate();
  const locale = useLocale();
  return (to: string) => navigate({ href: localizedPath(to, locale) });
}
