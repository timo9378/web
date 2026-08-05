import { describe, expect, it } from 'vitest';
import { postIdent, postPath } from './postPath';

// 文章網址的唯一組法。這裡錯了就是站內連結大面積 404，
// 而且是那種「改了 slug 之後才炸、當下測不到」的錯。

describe('postIdent', () => {
  it('有 slug 就用 slug', () => {
    expect(postIdent({ slug: 'why-i-switched-to-zed', id: 39 })).toBe('why-i-switched-to-zed');
  });

  it('沒有 slug 的舊資料退回用 id（後端兩種都認）', () => {
    expect(postIdent({ slug: null, id: 39 })).toBe('39');
    expect(postIdent({ id: 39 })).toBe('39');
  });

  it('slug 是空字串也要退回 id，不能組出 /blog/', () => {
    expect(postIdent({ slug: '', id: 39 })).toBe('39');
  });

  it('id 是字串（API 有時回字串）也一樣組得出來', () => {
    expect(postIdent({ id: '39' })).toBe('39');
  });
});

describe('postPath', () => {
  it('組出不含語系前綴的站內路徑（前綴由 LocaleLink 補）', () => {
    expect(postPath({ slug: 'why-i-switched-to-zed', id: 39 })).toBe('/blog/why-i-switched-to-zed');
    expect(postPath({ slug: null, id: 39 })).toBe('/blog/39');
  });

  it('永遠不會產出 /blog/（少了識別碼的空路徑）', () => {
    for (const p of [{ slug: '', id: 39 }, { slug: null, id: '7' }, { id: 0 }]) {
      expect(postPath(p)).not.toBe('/blog/');
    }
  });
});
