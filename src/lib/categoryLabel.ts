// 分類的「顯示名」多語系解析。
//
// ⚠️ 分類的 `name` 同時是**資料鍵**（posts.category 存的就是它、前台篩選也比對它），
// 所以譯名只用在「顯示」：這裡把 name → 該語系譯名，取不到就 fallback 回 name。
// 這樣加譯名永遠不會動到既有的資料關聯或篩選行為。
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blogCategoriesDetailQueryOptions, blogTagsQueryOptions, type CategoryInfo } from '../blogList';
import { useLocale } from '../locale-link';

/** locale → CategoryInfo 上的譯名欄位名。預設語系（zh-TW）與未知語系都用 name。 */
function fieldFor(locale: string): 'name_en' | 'name_ja' | 'name_ko' | 'name_zh_cn' | null {
  if (locale.startsWith('en')) return 'name_en';
  if (locale.startsWith('ja')) return 'name_ja';
  if (locale.startsWith('ko')) return 'name_ko';
  if (locale.toLowerCase().startsWith('zh-cn')) return 'name_zh_cn';
  return null;
}

/**
 * 回一個 `label(name)` 函式：吃分類的原始 name，回該語系的顯示名（沒譯名就回原名）。
 * 分類清單本來就會被抓（文章頁 tooltip / 部落格篩選共用同一份快取），不會多打 API。
 */
export function useCategoryLabel(): (name: string | null | undefined) => string {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  // 查詢用路徑 locale（與部落格頁/文章頁同一個 queryKey → 共用快取、不會多打一次 API）；
  // 譯名欄位仍照 i18n 的語系挑。清單雖然被語系過濾過，但畫面上出現的分類必然有該語系文章。
  const pathLocale = useLocale();
  const { data: categories } = useQuery(blogCategoriesDetailQueryOptions(pathLocale));

  return useMemo(() => {
    const field = fieldFor(locale);
    if (!field || !categories?.length) return (name) => name ?? '';
    const map = new Map<string, string>();
    for (const c of categories) {
      const translated = c[field];
      if (c.name && translated) map.set(c.name, translated);
    }
    return (name) => (name ? (map.get(name) ?? name) : '');
  }, [categories, locale]);
}

/**
 * 標籤版：同一套邏輯（name 是資料鍵，只換顯示名）。
 * 標籤清單在部落格頁本來就會抓，共用快取不會多打 API。
 */
export function useTagLabel(): (name: string | null | undefined) => string {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const pathLocale = useLocale();
  const { data: tags } = useQuery(blogTagsQueryOptions(pathLocale));

  return useMemo(() => {
    const field = fieldFor(locale);
    if (!field || !tags?.length) return (name) => name ?? '';
    const map = new Map<string, string>();
    for (const t of tags) {
      // 標籤清單可能是字串或物件（兩種來源），只有物件那種才帶得到譯名。
      if (typeof t !== 'object') continue;
      const row = t as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name : '';
      const translated = row[field];
      if (name && typeof translated === 'string' && translated) map.set(name, translated);
    }
    return (name) => (name ? (map.get(name) ?? name) : '');
  }, [tags, locale]);
}

/** locale → 後綴（en / ja / ko / zh_cn）；預設語系回 null（用原欄位）。 */
function suffixFor(locale: string): string | null {
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('ko')) return 'ko';
  if (locale.toLowerCase().startsWith('zh-cn')) return 'zh_cn';
  return null;
}

/**
 * 分類 tooltip 用：把 CategoryInfo 的 name / short_description / description
 * 換成當前語系的版本（沒譯文就退回原欄位）。
 */
export function useLocalizedCategoryInfo(): (info: CategoryInfo | null) => CategoryInfo | null {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => {
    const sfx = suffixFor(locale);
    if (!sfx) return (info) => info;
    return (info) => {
      if (!info) return info;
      const row = info as unknown as Record<string, unknown>;
      const pick = (base: string) => {
        const t = row[`${base}_${sfx}`];
        return typeof t === 'string' && t ? t : (row[base] as string | undefined);
      };
      return { ...info, name: pick('name'), short_description: pick('short_description'), description: pick('description') };
    };
  }, [locale]);
}
