// 分類的「顯示名」多語系解析。
//
// ⚠️ 分類的 `name` 同時是**資料鍵**（posts.category 存的就是它、前台篩選也比對它），
// 所以譯名只用在「顯示」：這裡把 name → 該語系譯名，取不到就 fallback 回 name。
// 這樣加譯名永遠不會動到既有的資料關聯或篩選行為。
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { blogCategoriesDetailQueryOptions, blogTagsQueryOptions, type CategoryInfo } from '@/data/blogList';
import { useLocale } from '@/hooks/useLocale';

/**
 * locale → 譯文欄位的後綴。預設語系（zh-TW）與未知語系回 null（用原欄位）。
 *
 * ⚠ 這張表是**唯一**一份。原本有兩份：`fieldFor()` 回 `'name_en'`、`suffixFor()` 回 `'en'`，
 * 各自把同一組 `startsWith` 判斷抄了一遍。加語系時漏改其中一份不會有任何錯誤——
 * 分類名照樣顯示，只是永遠是未翻譯的原文，而那正是「沒人會發現」的那種壞法。
 * 現在欄位名一律由後綴推導，兩層不可能對不上；
 * `categoryLabel.test.tsx` 最後那條（「兩層判斷不能漂移」）守的就是別再拆回兩份。
 */
function suffixFor(locale: string): 'en' | 'ja' | 'ko' | 'zh_cn' | null {
  if (locale.startsWith('en')) return 'en';
  if (locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('ko')) return 'ko';
  if (locale.toLowerCase().startsWith('zh-cn')) return 'zh_cn';
  return null;
}

/** locale → CategoryInfo / Tag 上的譯名欄位名（`name_<後綴>`）。 */
function fieldFor(locale: string): 'name_en' | 'name_ja' | 'name_ko' | 'name_zh_cn' | null {
  const sfx = suffixFor(locale);
  return sfx && (`name_${sfx}` as const);
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
      //
      // ⚠ 先落成 unknown 再收窄，`null` 那半邊才擋得住、也才不會被 oxlint 判成恆真：
      // 型別上 `t` 不可能是 null，但那個型別是 `JSON.parse` 之後貼上去的**宣稱**，
      // 不是保證。而 `typeof null === 'object'`——只判 typeof 的話 null 會通過守衛，
      // 下一行存取屬性直接 TypeError，而這個函式是在 render 期間呼叫的，
      // 一筆髒資料就會讓整個部落格頁白掉，不是只少一個譯名。
      //
      // （字串那半邊反而不影響結果：字串沒有 .name，本來就會被下面的 `if (name && …)`
      //  跳過。留著是因為它把「只有物件帶得到譯名」這個意圖寫出來了。）
      const raw: unknown = t;
      if (typeof raw !== 'object' || raw === null) continue;
      const row = raw as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name : '';
      const translated = row[field];
      if (name && typeof translated === 'string' && translated) map.set(name, translated);
    }
    return (name) => (name ? (map.get(name) ?? name) : '');
  }, [tags, locale]);
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
      // 譯文欄位（name_en / description_ja …）用動態 key 取，沒有就回 null；
      // 由呼叫端 `?? info.xxx` 退回原欄位 —— 這樣回傳型別跟著原欄位走
      //（name 是 string、description 是 string | null），不會整批被放寬成 undefined。
      const row = info as unknown as Record<string, unknown>;
      const tr = (base: string): string | null => {
        const t = row[`${base}_${sfx}`];
        return typeof t === 'string' && t ? t : null;
      };
      return {
        ...info,
        name: tr('name') ?? info.name,
        short_description: tr('short_description') ?? info.short_description,
        description: tr('description') ?? info.description,
      };
    };
  }, [locale]);
}
