import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import { localeFromPathname } from './start-i18n';
import { LOCALE_PREFIX, type Locale } from './lib/locales';

/** 目前路由的 locale(由 URL pathname 推得)。 */
export function useLocale(): Locale {
  return useRouterState({ select: (s) => localeFromPathname(s.location.pathname) });
}

/** locale-aware 程式化導航:navigate('/thinking') 會帶上目前 locale 前綴。
 * 用 href(官方逃生口)而非 to,才能吃帶 query/hash 的字串(如 /blog?category=X、/about#journey)。 */
export function useLocaleNavigate() {
  const navigate = useNavigate();
  const locale = useLocale();
  return (to: string) => navigate({ href: localizedPath(to, locale) });
}

/** 把「無前綴邏輯路徑」(如 '/about')加上目前 locale 前綴 → '/en/about';預設語言不加。 */
export function localizedPath(to: string, locale: Locale): string {
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return to; // 預設 zh-TW 無前綴
  return to === '/' ? `/${prefix}` : `/${prefix}${to}`;
}

/**
 * 內部導覽連結:自動帶上「目前 locale」前綴,讓使用者在 /en 下點連結還是留在 /en/*。
 * to 用無前綴邏輯路徑(如 '/'、'/about'、'/blog/39')。
 */
// 轉發所有底層 Link 的 props(className / children / onMouseEnter / onFocus / viewTransition / preload …),
// 只把 `to` 換成「無前綴邏輯路徑」並加上目前 locale 前綴。
type LocaleLinkProps = Omit<ComponentProps<typeof Link>, 'to'> & { to: string };

export function LocaleLink({ to, ...rest }: LocaleLinkProps) {
  const locale = useLocale();
  const full = localizedPath(to, locale);
  // TanStack <Link> 用獨立的 search/hash props,不解析 `to` 字串內的 ?/#(會被當 pathname 編碼掉)。
  // 簡單路徑維持 to={full};含 query/hash 時自行拆成 to/search/hash。
  if (full.includes('?') || full.includes('#')) {
    const hashIdx = full.indexOf('#');
    const hash = hashIdx >= 0 ? full.slice(hashIdx + 1) : undefined;
    const beforeHash = hashIdx >= 0 ? full.slice(0, hashIdx) : full;
    const qIdx = beforeHash.indexOf('?');
    const pathname = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
    const search = qIdx >= 0 ? Object.fromEntries(new URLSearchParams(beforeHash.slice(qIdx + 1))) : undefined;
    return <Link to={pathname} search={search as never} hash={hash} {...rest} />;
  }
  return <Link to={full} {...rest} />;
}
