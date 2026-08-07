// SEO meta 與 JSON-LD。
//
// 為什麼是這一支：整份 223 行**零覆蓋**，而它的失效方式是全站最安靜的一種——
// JSON-LD 壞掉在頁面上沒有任何症狀，讀者看不出來、CI 也不會紅，只是 Google 悄悄
// 不再給 rich results，幾個月後才會從 Search Console 發現「怎麼麵包屑不見了」。
// 而且它是純函式，測起來的成本趨近於零：沒有 DOM、沒有網路、沒有時間相依。
//
// 下面每一組對應一種「改壞了不會有人發現」的情況，而不是為了把行數蓋滿。
import { describe, expect, it } from 'vitest';

import {
  articleJsonLd,
  articleMeta,
  blogListJsonLd,
  LOCALE_TO_OG,
  pageMeta,
  siteJsonLd,
} from './seoMeta';

type Post = Parameters<typeof articleMeta>[0];

/** 最小可用的文章。要測某個欄位的缺席時傳 `{ 欄位: undefined }` 覆蓋掉它。 */
const post = (over: Record<string, unknown> = {}): Post =>
  ({
    id: 42,
    title: '測試文章',
    excerpt: '摘要',
    author: 'Koimsurai',
    category: '技術',
    tags: ['rust', 'typescript'],
    created_at: '2026-08-01 03:04:05',
    updated_at: '2026-08-02 06:07:08',
    ...over,
  }) as unknown as Post;

/** meta 陣列 → 依 name/property 取值 */
const pick = (tags: ReturnType<typeof pageMeta>, key: string): string | undefined =>
  tags.find((t) => t.name === key || t.property === key)?.content;

const parse = (s: { children: string }): Record<string, unknown> =>
  JSON.parse(s.children) as Record<string, unknown>;
const graph = (s: { children: string }): Record<string, unknown>[] =>
  parse(s)['@graph'] as Record<string, unknown>[];

describe('日期轉 ISO 8601', () => {
  // 後端存的是 SQLite datetime('now')：UTC，但**沒有時區標記**。
  // 直接塞給爬蟲會被當成當地時間（或整個解析失敗），文章日期就錯了八小時——
  // 這正是這個專案在別處踩過的同一個坑（見 src/lib/serverDate.ts）。
  it('SQLite 的 "YYYY-MM-DD HH:MM:SS" 補上 T 與 Z', () => {
    const m = articleMeta(post(), '/blog/42', 'zh-TW');
    expect(pick(m, 'article:published_time')).toBe('2026-08-01T03:04:05Z');
    expect(pick(m, 'article:modified_time')).toBe('2026-08-02T06:07:08Z');
  });

  it('轉出來的字串 Date 解析得動，而且真的是 UTC', () => {
    const m = articleMeta(post(), '/blog/42', 'zh-TW');
    // `?? ''` 不是防禦性程式碼：拿掉就得用 `!` 或 `as string`，而 oxlint 對那兩種
    // 各有一條規則互相打架（no-non-null-assertion / non-nullable-type-assertion-style）。
    // 值真的不存在時 new Date('') 會是 Invalid Date，斷言照樣紅。
    expect(new Date(pick(m, 'article:published_time') ?? '').toISOString())
      .toBe('2026-08-01T03:04:05.000Z');
  });

  it('已經是 ISO 的字串原樣不動，不會被加上第二個 Z', () => {
    const m = articleMeta(post({ created_at: '2026-08-01T03:04:05Z' }), '/blog/42', 'zh-TW');
    expect(pick(m, 'article:published_time')).toBe('2026-08-01T03:04:05Z');
  });

  // 沒有日期時要「整個標籤不出現」，而不是出一個 content=undefined 的空標籤
  it('沒有日期就不出那個標籤（而不是出一個空的）', () => {
    const m = articleMeta(post({ created_at: undefined, updated_at: undefined }), '/blog/42', 'zh-TW');
    expect(m.some((t) => t.property === 'article:published_time')).toBe(false);
    expect(m.some((t) => t.property === 'article:modified_time')).toBe(false);
    expect(m.every((t) => t.content !== undefined || t.title !== undefined)).toBe(true);
  });
});

describe('og:locale 的對應', () => {
  it('五個語系都對到 Facebook 認得的格式', () => {
    for (const [locale, og] of Object.entries(LOCALE_TO_OG)) {
      expect(pick(pageMeta('t', 'd', '/x', locale), 'og:locale')).toBe(og);
      // 格式必須是 xx_XX，寫成 zh-TW 這種 Facebook 不吃
      expect(og).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
  });

  // 認不得的語系要退回 zh_TW，不能吐 undefined——空的 og:locale 比沒有更糟
  it('認不得的語系退回 zh_TW', () => {
    expect(pick(pageMeta('t', 'd', '/x', 'de'), 'og:locale')).toBe('zh_TW');
    expect(pick(articleMeta(post(), '/blog/42', 'de'), 'og:locale')).toBe('zh_TW');
  });
});

describe('pageMeta', () => {
  it('有標題時加站名後綴，沒有標題時用站名本身', () => {
    expect(pageMeta('關於', 'd', '/about', 'zh-TW')[0].title).toBe('關於 - 宙と木');
    expect(pageMeta(null, 'd', '/', 'zh-TW')[0].title).toBe('宙と木 · Koimsurai');
  });

  // og:url / twitter:url 是爬蟲用來去重的鍵，指錯就會被判成別頁的複製品
  it('og:url 與 twitter:url 都是絕對網址，且與 canonicalPath 一致', () => {
    const m = pageMeta('t', 'd', '/en/music', 'en');
    expect(pick(m, 'og:url')).toBe('https://koimsurai.com/en/music');
    expect(pick(m, 'twitter:url')).toBe('https://koimsurai.com/en/music');
  });

  // 尺寸標錯的話 Facebook 會裁切或整個不顯示預覽圖
  it('og:image 帶著與實際圖一致的尺寸', () => {
    const m = pageMeta('t', 'd', '/', 'zh-TW');
    expect(pick(m, 'og:image')).toBe('https://koimsurai.com/og-default-v2.png');
    expect(pick(m, 'og:image:width')).toBe('1200');
    expect(pick(m, 'og:image:height')).toBe('630');
  });
});

describe('articleMeta', () => {
  it('og:title 用純標題，<title> 才加站名後綴', () => {
    const m = articleMeta(post(), '/blog/42', 'zh-TW');
    expect(m[0].title).toBe('測試文章 - 宙と木');
    expect(pick(m, 'og:title')).toBe('測試文章');
  });

  it('og:image 指向後端產的那張，網址帶文章 id', () => {
    expect(pick(articleMeta(post(), '/blog/42', 'zh-TW'), 'og:image'))
      .toBe('https://koimsurai.com/api/og/42.png');
  });

  it('og:type 是 article，不是首頁那種 website', () => {
    expect(pick(articleMeta(post(), '/blog/42', 'zh-TW'), 'og:type')).toBe('article');
    expect(pick(pageMeta('t', 'd', '/', 'zh-TW'), 'og:type')).toBe('website');
  });

  it('沒有作者就不出 article:author', () => {
    const m = articleMeta(post({ author: undefined }), '/blog/42', 'zh-TW');
    expect(m.some((t) => t.property === 'article:author')).toBe(false);
  });
});

describe('articleJsonLd', () => {
  it('@graph 就是 BlogPosting + BreadcrumbList 兩個實體', () => {
    expect(graph(articleJsonLd(post(), '/blog/42')).map((g) => g['@type']))
      .toEqual(['BlogPosting', 'BreadcrumbList']);
  });

  // ⚠ 這條守的是原始碼裡那段註解記下來的事故：Google 規定 `item` 對「除了最後一項以外」
  // 的每個 ListItem 都必填，曾經有一層只給 name 不給 item → Rich Results 直接判重大問題。
  // 這裡要求**每一項**都有 item（比規格更嚴），因為三層我們都給得出正當網址。
  it('麵包屑每一項都有 name 與 item，position 從 1 連號', () => {
    const bc = graph(articleJsonLd(post(), '/blog/42'))[1];
    const items = bc.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    items.forEach((it, i) => {
      expect(it.position, `第 ${i + 1} 項的 position`).toBe(i + 1);
      expect(it.name, `第 ${i + 1} 項的 name`).toBeTruthy();
      expect(String(it.item), `第 ${i + 1} 項的 item`).toMatch(/^https:\/\/koimsurai\.com/);
    });
  });

  it('麵包屑最後一項指向文章本身，中間那層指向該語系的 blog 列表', () => {
    const items = graph(articleJsonLd(post(), '/en/blog/42', 'en'))[1]
      .itemListElement as Record<string, unknown>[];
    expect(items[0].item).toBe('https://koimsurai.com/en');
    expect(items[1].item).toBe('https://koimsurai.com/en/blog');
    expect(items[2].item).toBe('https://koimsurai.com/en/blog/42');
  });

  // 預設語系不帶前綴（保留既有已索引的網址），這件事在麵包屑上最容易寫錯
  it('預設語系 zh-TW 的麵包屑不帶語系前綴', () => {
    const items = graph(articleJsonLd(post(), '/blog/42'))[1].itemListElement as Record<string, unknown>[];
    expect(items[0].item).toBe('https://koimsurai.com/');
    expect(items[1].item).toBe('https://koimsurai.com/blog');
  });

  it('inLanguage 跟著語系走——五語站台只靠 hreflang 推斷會被歸錯語言', () => {
    for (const l of ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'] as const) {
      expect(graph(articleJsonLd(post(), '/blog/42', l))[0].inLanguage).toBe(l);
    }
  });

  it('沒有 updated_at 時 dateModified 退回 datePublished', () => {
    const bp = graph(articleJsonLd(post({ updated_at: undefined }), '/blog/42'))[0];
    expect(bp.dateModified).toBe('2026-08-01T03:04:05Z');
    expect(bp.dateModified).toBe(bp.datePublished);
  });

  it('沒有標籤／分類時就不出那個欄位（空字串會被判成無效值）', () => {
    const bp = graph(articleJsonLd(post({ tags: [], category: undefined }), '/blog/42'))[0];
    expect('keywords' in bp).toBe(false);
    expect('articleSection' in bp).toBe(false);
  });

  it('有標籤時 keywords 是逗號分隔的字串，不是陣列', () => {
    expect(graph(articleJsonLd(post(), '/blog/42'))[0].keywords).toBe('rust, typescript');
  });

  it('沒有作者時退回站主名稱，不會變成 null', () => {
    const bp = graph(articleJsonLd(post({ author: undefined }), '/blog/42'))[0];
    expect((bp.author as Record<string, unknown>).name).toBe('Koimsurai');
  });
});

describe('跨頁的 @id 必須對得起來', () => {
  // 圖斷開之後站上完全沒有症狀，只是 Google 不再把文章列表跟站台／作者實體連起來。
  // 這種「改一邊忘了改另一邊」正是最容易發生、又最不會被發現的回歸。
  it('blogListJsonLd 參照的 #website / #person 真的存在於 siteJsonLd', () => {
    const ids = new Set(graph(siteJsonLd()).map((g) => g['@id']));
    const list = parse(blogListJsonLd());
    expect(ids).toContain((list.isPartOf as Record<string, string>)['@id']);
    expect(ids).toContain((list.publisher as Record<string, string>)['@id']);
  });

  it('siteJsonLd 裡 WebSite 的 publisher 指到同一份 Person', () => {
    const [site, person] = graph(siteJsonLd());
    expect((site.publisher as Record<string, string>)['@id']).toBe(person['@id']);
  });

  // @id 是實體的身分證，必須跟語系無關——每個語系各自一組會變成五個不同的「作者」
  it('實體的 @id 不隨語系改變，但 url / inLanguage 要跟著改', () => {
    const zh = graph(siteJsonLd('zh-TW'));
    const ja = graph(siteJsonLd('ja'));
    expect(ja.map((g) => g['@id'])).toEqual(zh.map((g) => g['@id']));
    expect(ja[0].url).toBe('https://koimsurai.com/ja');
    expect(ja[0].inLanguage).toBe('ja');
  });
});

describe('塞進 <script> 之前的逸出', () => {
  // JSON.stringify 不會動 `<`，而標題是後台打得進去的欄位——出現 `</script>` 的話
  // HTML parser 會在那裡把 script 提早收掉，後面的內容變成頁面上的裸 HTML。
  const evil = 'A</script><img src=x onerror=alert(1)>B';

  it('標題裡的 </script> 不會原樣出現在輸出裡', () => {
    for (const s of [
      articleJsonLd(post({ title: evil }), '/blog/42'),
      articleJsonLd(post({ excerpt: evil }), '/blog/42'),
    ]) {
      expect(s.children).not.toContain('</script>');
      expect(s.children).not.toContain('<');
    }
  });

  it('逸出之後 JSON 仍然解析得回原字串（爬蟲讀到的值不變）', () => {
    const bp = graph(articleJsonLd(post({ title: evil }), '/blog/42'))[0];
    expect(bp.headline).toBe(evil);
  });

  it('三個產生器吐出來的都是合法 JSON 與正確的 script type', () => {
    for (const s of [articleJsonLd(post(), '/blog/42'), siteJsonLd(), blogListJsonLd()]) {
      expect(s.type).toBe('application/ld+json');
      expect(() => JSON.parse(s.children) as unknown).not.toThrow();
      expect(parse(s)['@context']).toBe('https://schema.org');
    }
  });
});
