import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_PREFIX, localePathname, SUPPORTED_LOCALES } from './locales';

// 這支同時被前端路由與 Nitro 的 sitemap.xml route 用。
// 網址組錯了不會有 error，只會安靜地產出一份指向 404 的 sitemap，所以要有測試盯著。

describe('localePathname', () => {
  it('預設語系不帶前綴（既有已索引的網址不能變）', () => {
    expect(localePathname('zh-TW')).toBe('/');
    expect(localePathname('zh-TW', 'blog/39')).toBe('/blog/39');
  });

  it('其餘語系用小寫前綴', () => {
    expect(localePathname('en', 'blog/39')).toBe('/en/blog/39');
    expect(localePathname('ja', 'blog/39')).toBe('/ja/blog/39');
    expect(localePathname('ko', 'blog/39')).toBe('/ko/blog/39');
    expect(localePathname('zh-CN', 'blog/39')).toBe('/zh-cn/blog/39');
  });

  it('每個語系的首頁都是乾淨的一層，不會多一條斜線', () => {
    for (const loc of SUPPORTED_LOCALES) {
      const p = localePathname(loc);
      expect(p.startsWith('/')).toBe(true);
      expect(p).not.toContain('//');
      expect(p.endsWith('/')).toBe(loc === DEFAULT_LOCALE); // 只有 zh-TW 是單獨的 '/'
    }
  });

  it('呼叫端多給的開頭斜線會被吃掉，不會變成 //', () => {
    expect(localePathname('en', '/blog/39')).toBe('/en/blog/39');
    expect(localePathname('en', '///blog/39')).toBe('/en/blog/39');
    expect(localePathname('zh-TW', '/blog/39')).toBe('/blog/39');
  });

  it('每個支援的語系都有前綴設定（漏一個會在 sitemap 悄悄生出重複網址）', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(LOCALE_PREFIX[loc]).toBeDefined();
    }
    const prefixes = SUPPORTED_LOCALES.map((l) => LOCALE_PREFIX[l]);
    expect(new Set(prefixes).size).toBe(prefixes.length); // 不能有兩個語系共用同一個前綴
  });
});
