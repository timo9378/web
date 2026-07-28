import { I18nextProvider } from 'react-i18next';
import { useMemo, type ReactNode } from 'react';
import type { Locale } from './lib/locales';
import { createI18n } from './start-i18n';

// 從 start-i18n 拆出來的唯一原因：那支檔案其餘 export 全是純函式／常數，
// 元件與非元件混在同一個模組會讓 Vite Fast Refresh 退回整頁重載
// （react-refresh only-export-components）。拆開後 start-i18n 變成純 .ts，
// 消費工具函式的檔案 import 路徑完全不用動。

/** 依 locale 提供一個獨立 i18n instance 給子樹。server/client 皆可，以 locale memo。 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const i18n = useMemo(() => createI18n(locale), [locale]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
