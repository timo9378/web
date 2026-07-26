// 分類的「顯示名」多語系解析。
//
// ⚠️ 分類的 `name` 同時是**資料鍵**（posts.category 存的就是它、前台篩選也比對它），
// 所以譯名只用在「顯示」：這裡把 name → 該語系譯名，取不到就 fallback 回 name。
// 這樣加譯名永遠不會動到既有的資料關聯或篩選行為。
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blogCategoriesDetailQueryOptions, blogTagsQueryOptions } from '../blogList';

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
  const { data: categories } = useQuery(blogCategoriesDetailQueryOptions);

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
  const { data: tags } = useQuery(blogTagsQueryOptions);

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
