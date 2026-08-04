// start-i18n 純函式的單元測試：locale 解析／URL 建構／hreflang／Accept-Language
// 協商／bot 偵測，以及「每 render 獨立 i18n instance」的隔離保證（SSR 不互踩的關鍵）。
import { describe, expect, it } from 'vitest';

import { LOCALE_LABELS, buildAlternateLinks, createI18n, localeFromPathname, localeFromPrefix, localeUrl, pickLocaleFromAcceptLanguage, stripLocalePrefix, toLocales } from './start-i18n';
import { isBotUserAgent } from '@/lib/bot';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/lib/locales';

describe('localeFromPrefix', () => {
  it('無前綴 → 預設 zh-TW', () => {
    expect(localeFromPrefix(undefined)).toBe('zh-TW');
    expect(localeFromPrefix('')).toBe('zh-TW');
  });
  it('支援的前綴（大小寫不敏感）', () => {
    expect(localeFromPrefix('en')).toBe('en');
    expect(localeFromPrefix('EN')).toBe('en');
    expect(localeFromPrefix('zh-cn')).toBe('zh-CN');
    expect(localeFromPrefix('ZH-CN')).toBe('zh-CN');
  });
  it('非支援前綴 → null（路由 notFound）', () => {
    expect(localeFromPrefix('fr')).toBeNull();
    expect(localeFromPrefix('blog')).toBeNull();
  });
});

describe('localeFromPathname / stripLocalePrefix', () => {
  it('pathname 第一段決定 locale', () => {
    expect(localeFromPathname('/en/blog/39')).toBe('en');
    expect(localeFromPathname('/zh-cn/about')).toBe('zh-CN');
    expect(localeFromPathname('/blog/39')).toBe('zh-TW');
    expect(localeFromPathname('/')).toBe('zh-TW');
  });
  it('strip 只剝非預設語言的前綴', () => {
    expect(stripLocalePrefix('/en/blog/39')).toBe('blog/39');
    expect(stripLocalePrefix('/blog/39')).toBe('blog/39');
    expect(stripLocalePrefix('/en')).toBe('');
    expect(stripLocalePrefix('/')).toBe('');
  });
});

describe('toLocales', () => {
  it('空值 → 預設語言', () => {
    expect(toLocales(undefined)).toEqual([DEFAULT_LOCALE]);
    expect(toLocales([])).toEqual([DEFAULT_LOCALE]);
  });
  it('過濾不支援的、依 SUPPORTED_LOCALES 排序', () => {
    expect(toLocales(['ja', 'en', 'xx'])).toEqual(['en', 'ja']);
    expect(toLocales(['zh-TW', 'ko'])).toEqual(['zh-TW', 'ko']);
  });
});

describe('localeUrl / buildAlternateLinks', () => {
  it('預設語言無前綴、其餘帶前綴', () => {
    expect(localeUrl('zh-TW', '')).toBe('https://koimsurai.com/');
    expect(localeUrl('zh-TW', '/blog/39')).toBe('https://koimsurai.com/blog/39');
    expect(localeUrl('en', 'blog/39')).toBe('https://koimsurai.com/en/blog/39');
    expect(localeUrl('zh-CN', 'about')).toBe('https://koimsurai.com/zh-cn/about');
  });
  it('canonical 指當前語言、附全語言 alternates 與 x-default', () => {
    const links = buildAlternateLinks('blog/39', 'en', ['zh-TW', 'en']);
    expect(links[0]).toEqual({ rel: 'canonical', href: 'https://koimsurai.com/en/blog/39' });
    expect(links).toContainEqual({
      rel: 'alternate',
      hreflang: 'zh-TW',
      href: 'https://koimsurai.com/blog/39',
    });
    expect(links).toContainEqual({
      rel: 'alternate',
      hreflang: 'x-default',
      href: 'https://koimsurai.com/blog/39',
    });
    // 只列文章實際存在的語言（+canonical +x-default）
    expect(links).toHaveLength(4);
  });
});

describe('pickLocaleFromAcceptLanguage', () => {
  it('缺 header → 預設', () => {
    expect(pickLocaleFromAcceptLanguage(undefined)).toBe(DEFAULT_LOCALE);
    expect(pickLocaleFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
  });
  it('依 q 值挑最佳支援語言', () => {
    expect(pickLocaleFromAcceptLanguage('ja,en;q=0.8')).toBe('ja');
    expect(pickLocaleFromAcceptLanguage('en;q=0.5,ko;q=0.9')).toBe('ko');
  });
  it('中文變體正規化', () => {
    expect(pickLocaleFromAcceptLanguage('zh-HK')).toBe('zh-TW');
    expect(pickLocaleFromAcceptLanguage('zh-Hans')).toBe('zh-CN');
    expect(pickLocaleFromAcceptLanguage('zh')).toBe('zh-TW');
  });
  it('全不支援 → 預設', () => {
    expect(pickLocaleFromAcceptLanguage('fr-FR,de;q=0.8')).toBe(DEFAULT_LOCALE);
  });
});

describe('isBotUserAgent', () => {
  it('爬蟲/預覽 UA → true', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBotUserAgent('Discordbot/2.0')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
  });
  it('一般瀏覽器與空值 → false', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      ),
    ).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
    expect(isBotUserAgent('')).toBe(false);
  });
});

describe('翻譯資源與常數一致性', () => {
  it('LOCALE_LABELS 覆蓋所有支援語言', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[locale], locale).toBeTruthy();
    }
  });
  it('五語 bundle 的 key 集合一致（漏翻會在這裡現形）', () => {
    const keysOf = (locale: (typeof SUPPORTED_LOCALES)[number]) => {
      const bundle = createI18n(locale).getResourceBundle(locale, 'common') as Record<
        string,
        unknown
      >;
      const flat: string[] = [];
      const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [k, v] of Object.entries(obj)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object') walk(v as Record<string, unknown>, key);
          else flat.push(key);
        }
      };
      walk(bundle, '');
      return flat.sort();
    };
    const reference = keysOf('zh-TW');
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of SUPPORTED_LOCALES) {
      expect(keysOf(locale), `${locale} 的 key 集合應與 zh-TW 一致`).toEqual(reference);
    }
  });
});

describe('createI18n instance 隔離（SSR 並發不互踩）', () => {
  it('兩個 instance 各自維持語言', async () => {
    const a = createI18n('en');
    const b = createI18n('ja');
    expect(a.language).toBe('en');
    expect(b.language).toBe('ja');
    await a.changeLanguage('ko');
    expect(a.language).toBe('ko');
    expect(b.language).toBe('ja');
  });
});
