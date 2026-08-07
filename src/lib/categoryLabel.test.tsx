// @vitest-environment jsdom
//
// 分類／標籤的多語系顯示名。
//
// 為什麼是這一支：行覆蓋 39% 但**分支只有 14%**——也就是「哪個語系該拿哪個欄位」
// 這件事幾乎完全沒被走過，而那正是整支的重點。它壞掉的方式也很安靜：
// 顯示名退回原文（中文）不會報錯、不會紅，只有在**非預設語系**的頁面上看得出來，
// 而那正是作者自己最少打開的版本。
//
// ⚠ 這裡刻意測 hook 的對外行為而不是把 fieldFor / suffixFor 挖出來測。
// 那兩個函式曾經各自寫了一份「locale → 語系變體」的判斷（一個回欄位名 `name_en`、
// 一個回後綴 `en`），彼此沒有任何關聯——只在其中一邊加語系是最可能發生的回歸。
// 現在 fieldFor 由 suffixFor 推導，但測試維持測對外行為：那樣不管日後怎麼實作，
// 「分類名翻了、tooltip 沒翻」這個症狀都跑不掉（見最後一條）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// 三個外部依賴全部換掉：這支要測的是純粹的對應邏輯，不是 react-query 或 i18next。
let locale = 'zh-TW';
let queryData: unknown = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: locale, language: locale } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: queryData }),
}));
vi.mock('@/hooks/useLocale', () => ({ useLocale: () => 'zh-TW' }));
// blogList 只被拿來當 queryOptions 的來源，import 進來會牽出 fetch —— 給空殼即可
vi.mock('@/data/blogList', () => ({
  blogCategoriesDetailQueryOptions: () => ({ queryKey: ['c'] }),
  blogTagsQueryOptions: () => ({ queryKey: ['t'] }),
}));

const { useCategoryLabel, useLocalizedCategoryInfo, useTagLabel } = await import('./categoryLabel');

/** 一筆五語系齊全的分類 */
const CAT = {
  name: '技術',
  name_en: 'Tech',
  // ⚠ 刻意與 name 不同：兩者相同的話「有沒有翻到」就判斷不出來，
  // 下面那條防漂移的測試會變成恆真的空斷言。
  name_ja: 'テック',
  name_ko: '기술',
  name_zh_cn: '技术',
  short_description: '短',
  short_description_en: 'short',
  description: '長',
  description_en: 'long',
};

const labelFor = (l: string, data: unknown) => {
  locale = l;
  queryData = data;
  return renderHook(() => useCategoryLabel()).result.current;
};

beforeEach(() => {
  locale = 'zh-TW';
  queryData = undefined;
});

describe('useCategoryLabel：語系 → 譯名欄位', () => {
  it('四個有譯名的語系各自取到對的欄位', () => {
    expect(labelFor('en', [CAT])('技術')).toBe('Tech');
    expect(labelFor('ja', [CAT])('技術')).toBe('テック');
    expect(labelFor('ko', [CAT])('技術')).toBe('기술');
    expect(labelFor('zh-CN', [CAT])('技術')).toBe('技术');
  });

  // 預設語系不該去查譯名欄位——name 本來就是中文原文，也是資料鍵
  it('預設語系 zh-TW 直接回原名', () => {
    expect(labelFor('zh-TW', [CAT])('技術')).toBe('技術');
  });

  // 地區碼是實際會出現的：i18n 的 resolvedLanguage 可能是 en-US / ja-JP
  it('帶地區碼的語系也認得（en-US / ja-JP / ko-KR）', () => {
    expect(labelFor('en-US', [CAT])('技術')).toBe('Tech');
    expect(labelFor('ja-JP', [CAT])('技術')).toBe('テック');
    expect(labelFor('ko-KR', [CAT])('技術')).toBe('기술');
  });

  // ⚠ zh-CN 的判斷有 toLowerCase()，大小寫寫法都要吃得下
  it('zh-CN 不分大小寫', () => {
    expect(labelFor('zh-cn', [CAT])('技術')).toBe('技术');
    expect(labelFor('ZH-CN', [CAT])('技術')).toBe('技术');
  });

  // ⚠ 這條擋的是「用 startsWith('zh') 判斷」這種寫法：那樣 zh-TW 會被誤判成簡體
  it('zh-TW 不會被 zh-CN 的判斷誤抓', () => {
    expect(labelFor('zh-TW', [CAT])('技術')).toBe('技術');
    expect(labelFor('zh-Hant-TW', [CAT])('技術')).toBe('技術');
  });

  it('認不得的語系回原名，不是空字串也不是 undefined', () => {
    expect(labelFor('de', [CAT])('技術')).toBe('技術');
  });
});

describe('useCategoryLabel：查不到譯名時的退回', () => {
  // name 同時是資料鍵（posts.category 存的就是它），退回原名才不會讓篩選壞掉
  it('清單裡沒有這個分類 → 回原名', () => {
    expect(labelFor('en', [CAT])('生活')).toBe('生活');
  });

  it('該語系的譯名是空字串 → 回原名（空字串不是有效的顯示名）', () => {
    expect(labelFor('en', [{ ...CAT, name_en: '' }])('技術')).toBe('技術');
  });

  it('清單還沒載入（undefined）或是空的 → 回原名', () => {
    expect(labelFor('en', undefined)('技術')).toBe('技術');
    expect(labelFor('en', [])('技術')).toBe('技術');
  });

  // 呼叫端會把 post.category 直接丟進來，而那個欄位可能是 null
  it('傳 null / undefined / 空字串一律回空字串，不會吐 "null"', () => {
    const label = labelFor('en', [CAT]);
    expect(label(null)).toBe('');
    expect(label(undefined)).toBe('');
    expect(label('')).toBe('');
  });
});

describe('useTagLabel', () => {
  const TAG = { name: 'rust', name_en: 'Rust', name_ja: 'ラスト', name_ko: '러스트', name_zh_cn: '铁锈' };
  const tagLabel = (l: string, data: unknown) => {
    locale = l;
    queryData = data;
    return renderHook(() => useTagLabel()).result.current;
  };

  it('物件形式的標籤取得到譯名', () => {
    expect(tagLabel('ja', [TAG])('rust')).toBe('ラスト');
    expect(tagLabel('zh-CN', [TAG])('rust')).toBe('铁锈');
  });

  // 標籤清單有兩種來源，其中一種只回字串陣列——那種沒有譯名可拿
  it('字串形式的標籤直接跳過，不會炸也不會誤譯', () => {
    expect(tagLabel('en', ['rust', 'typescript'])('rust')).toBe('rust');
  });

  it('兩種形式混在一起時，物件那些照樣翻得到', () => {
    expect(tagLabel('en', ['typescript', TAG])('rust')).toBe('Rust');
    expect(tagLabel('en', ['typescript', TAG])('typescript')).toBe('typescript');
  });

  // 譯名欄位不是字串（後端資料髒掉）時不該讓整頁掛掉
  it('譯名欄位型別不對就當作沒有', () => {
    expect(tagLabel('en', [{ ...TAG, name_en: 123 }])('rust')).toBe('rust');
    expect(tagLabel('en', [{ ...TAG, name_en: null }])('rust')).toBe('rust');
  });

  // ⚠ 這條是變異測試逼出來的。`typeof null === 'object'`，所以只判 typeof 的守衛擋不住
  // null，下一行存取屬性就 TypeError——而這個函式是在 render 期間呼叫的，
  // 一筆髒資料會讓整個部落格頁白掉，而不只是少一個譯名。
  it('清單裡混進 null 不會炸，其餘照樣翻得到', () => {
    expect(() => tagLabel('en', [null, TAG])('rust')).not.toThrow();
    expect(tagLabel('en', [null, TAG])('rust')).toBe('Rust');
  });
});

describe('useLocalizedCategoryInfo', () => {
  const infoFor = (l: string) => {
    locale = l;
    return renderHook(() => useLocalizedCategoryInfo()).result.current;
  };

  it('name / short_description / description 三個欄位一起換', () => {
    const out = infoFor('en')(CAT as never);
    expect(out?.name).toBe('Tech');
    expect(out?.short_description).toBe('short');
    expect(out?.description).toBe('long');
  });

  // 部分翻譯是常態：有 name_ja 但沒有 description_ja
  it('只有部分欄位有譯文時，其餘退回原欄位', () => {
    const out = infoFor('ja')(CAT as never);
    expect(out?.name).toBe('テック'); // name_ja 有
    expect(out?.description).toBe('長'); // description_ja 沒有 → 原欄位
  });

  it('預設語系原樣回傳，null 也照樣回 null', () => {
    expect(infoFor('zh-TW')(CAT as never)).toBe(CAT);
    expect(infoFor('en')(null)).toBeNull();
    expect(infoFor('zh-TW')(null)).toBeNull();
  });

  // ⚠ 這條是這支測試最重要的一條。
  // 語系 → 變體的判斷原本在 categoryLabel.ts 裡寫了**兩份**（fieldFor 回 `name_en`、
  // suffixFor 回 `en`），彼此沒有任何關聯。只在其中一邊加語系的話，分類名翻了但
  // tooltip 沒翻——而那只有在該語系的頁面上才看得出來。
  //
  // 現在 fieldFor 由 suffixFor 推導，只剩一張表，這條的角色也跟著變：
  // 它守的不再是「有沒有記得改兩邊」，而是**不准有人再把兩層拆開各寫一份**。
  // 拆回去的那一刻這條不會馬上紅（兩份剛拆出來是一致的），但下次加語系就會紅在這裡。
  it('會翻分類名的語系，tooltip 也一定翻得到（兩層判斷不能漂移）', () => {
    for (const l of ['en', 'ja', 'ko', 'zh-CN']) {
      const translatedLabel = labelFor(l, [CAT])('技術') !== CAT.name;
      const translatedInfo = infoFor(l)(CAT as never)?.name !== CAT.name;
      expect(translatedLabel, `${l} 的分類名`).toBe(true);
      expect(translatedInfo, `${l} 的 tooltip`).toBe(true);
    }
  });
});
