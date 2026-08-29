import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dedupeWatchItems, filterAndSortBooks, filterAndSortWatchItems } from './mediaLists';

/**
 * 性質測試（fast-check）。
 *
 * 跟上面那份逐例測試的分工：那邊釘的是**我想得到的**具體情況（含變異測試指出來的邊界），
 * 這裡問的是「不管餵什麼進去，都該成立的事」——它會自己生上千組輸入去踩，
 * 找的是我沒想到要測的組合。失敗時 fast-check 會把反例縮到最小再印出來。
 *
 * ⚠ 只對純函式做。這幾支沒有 IO、沒有時序，同樣的輸入永遠同樣的輸出，
 *   才有辦法用「性質」描述。對元件做這件事只會得到一堆不穩定的測試。
 *
 * ⚠ 刻意不設 seed：每次跑不同的隨機輸入才有機會踩到新東西。
 *   真的踩到時 fast-check 會印出 seed 與 path，照它給的指令就能穩定重現。
 */

const bookArb = fc.record({
  title: fc.string({ maxLength: 12 }),
  authors: fc.option(fc.string({ maxLength: 12 }), { nil: null }),
  reading_status: fc.constantFrom('read', 'reading', 'to-read'),
  rating: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  // ⚠ `noInvalidDate` 不能省：fc.date() 預設會生出 Invalid Date（那是它刻意要幫你踩的
  //    邊界），而 `toISOString()` 對它會直接丟 RangeError，測試會在「產生輸入」的階段就死掉。
  date_added: fc
    .option(fc.date({ min: new Date('2000-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }), { nil: null })
    .map((d) => (d ? d.toISOString() : null)),
  published_date: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
});

const SORTS = [
  'date_added_asc',
  'date_added_desc',
  'title_asc',
  'title_desc',
  'rating_desc',
  'published_date_desc',
  '',
];

/** 依參考位址數個數，用來比對「兩個陣列裝的是同一批物件」。 */
function countByRef<T>(arr: readonly T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

describe('filterAndSortBooks 的性質', () => {
  it('排序永遠不會增減書本（只換順序）', () => {
    fc.assert(
      fc.property(fc.array(bookArb, { maxLength: 30 }), fc.constantFrom(...SORTS), (books, sortBy) => {
        const out = filterAndSortBooks(books, { searchTerm: '', statusFilter: 'all', ratingFilter: 'all', sortBy });
        expect(out).toHaveLength(books.length);
        // ⚠ 不能寫 `[...out].sort()` 去比對「集合相同」：預設 comparator 會把物件都轉成
        //   "[object Object]"，比較恆為 0，排序等於沒發生——那條斷言實際上在要求
        //   「排序後順序不變」，而那正好是排序函式不該做的事。（這個錯就是 fast-check
        //   第一輪就踩出來的。）依參考位址數個數才是真的比集合。
        expect(countByRef(out)).toEqual(countByRef(books));
      }),
    );
  });

  it('篩選的結果永遠是原清單的子集合，而且不會重複', () => {
    fc.assert(
      fc.property(
        fc.array(bookArb, { maxLength: 30 }),
        fc.string({ maxLength: 4 }),
        fc.constantFrom('all', 'read', 'reading', 'to-read'),
        (books, searchTerm, statusFilter) => {
          const out = filterAndSortBooks(books, { searchTerm, statusFilter, ratingFilter: 'all', sortBy: '' });
          expect(out.length).toBeLessThanOrEqual(books.length);
          for (const b of out) expect(books).toContain(b);
          expect(new Set(out).size).toBe(out.length);
        },
      ),
    );
  });

  it('永遠不動到傳進來的陣列', () => {
    fc.assert(
      fc.property(fc.array(bookArb, { maxLength: 20 }), fc.constantFrom(...SORTS), (books, sortBy) => {
        const snapshot = [...books];
        filterAndSortBooks(books, { searchTerm: 'a', statusFilter: 'all', ratingFilter: 'all', sortBy });
        expect(books).toEqual(snapshot);
      }),
    );
  });

  it('書名升冪與降冪互為顛倒（書名互異時）', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 20 }), (names) => {
        const books = names.map((title) => ({ title }));
        const base = { searchTerm: '', statusFilter: 'all', ratingFilter: 'all' };
        const asc = filterAndSortBooks(books, { ...base, sortBy: 'title_asc' }).map((b) => b.title);
        const desc = filterAndSortBooks(books, { ...base, sortBy: 'title_desc' }).map((b) => b.title);
        expect(desc).toEqual([...asc].reverse());
      }),
    );
  });

  it('搜尋出來的每一本，書名或作者真的含有關鍵字', () => {
    fc.assert(
      fc.property(fc.array(bookArb, { maxLength: 30 }), fc.string({ minLength: 1, maxLength: 3 }), (books, term) => {
        const out = filterAndSortBooks(books, {
          searchTerm: term,
          statusFilter: 'all',
          ratingFilter: 'all',
          sortBy: '',
        });
        const t = term.toLowerCase();
        for (const b of out) {
          expect(b.title.toLowerCase().includes(t) || (b.authors?.toLowerCase().includes(t) ?? false)).toBe(true);
        }
      }),
    );
  });
});

const watchArb = fc.record({
  title: fc.string({ maxLength: 10 }),
  tmdbId: fc.option(fc.integer({ min: 1, max: 8 }), { nil: null }),
  epCount: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
  isoDate: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
});

describe('dedupeWatchItems 的性質', () => {
  it('沒有 tmdbId 的一個都不會被去掉', () => {
    fc.assert(
      fc.property(fc.array(watchArb, { maxLength: 20 }), fc.array(watchArb, { maxLength: 20 }), (a, t) => {
        const out = dedupeWatchItems(a, t);
        expect(out.anime.filter((x) => x.tmdbId == null)).toEqual(a.filter((x) => x.tmdbId == null));
        expect(out.tv.filter((x) => x.tmdbId == null)).toEqual(t.filter((x) => x.tmdbId == null));
      }),
    );
  });

  it('每個 tmdbId 去重後只會剩一筆，而且是集數最多的那個值', () => {
    fc.assert(
      fc.property(fc.array(watchArb, { maxLength: 20 }), fc.array(watchArb, { maxLength: 20 }), (a, t) => {
        const out = [...dedupeWatchItems(a, t).anime, ...dedupeWatchItems(a, t).tv];
        const withId = out.filter((x) => x.tmdbId != null);
        const ids = withId.map((x) => x.tmdbId);
        expect(new Set(ids).size, '同一個 tmdbId 出現超過一次').toBe(ids.length);

        const maxOf = (id: number | string) =>
          Math.max(...[...a, ...t].filter((x) => x.tmdbId === id).map((x) => x.epCount ?? 0));
        for (const x of withId) {
          if (x.tmdbId == null) continue; // 上面已經濾掉，這裡是給型別看的（oxlint 禁 `!`）
          expect(x.epCount ?? 0).toBe(maxOf(x.tmdbId));
        }
      }),
    );
  });

  it('去重不會憑空生出東西，也不會保留原本不存在的項目', () => {
    fc.assert(
      fc.property(fc.array(watchArb, { maxLength: 20 }), fc.array(watchArb, { maxLength: 20 }), (a, t) => {
        const out = dedupeWatchItems(a, t);
        expect(out.anime.length).toBeLessThanOrEqual(a.length);
        expect(out.tv.length).toBeLessThanOrEqual(t.length);
        for (const x of out.anime) expect(a).toContain(x);
        for (const x of out.tv) expect(t).toContain(x);
      }),
    );
  });
});

describe('filterAndSortWatchItems 的性質', () => {
  it('沒有日期的永遠排在有日期的後面，不管哪種排序', () => {
    fc.assert(
      fc.property(fc.array(watchArb, { maxLength: 25 }), fc.constantFrom('newest', 'oldest'), (list, sortBy) => {
        const out = filterAndSortWatchItems(list, '', sortBy);
        const firstMissing = out.findIndex((x) => !x.isoDate);
        if (firstMissing === -1) return;
        expect(
          out.slice(firstMissing).every((x) => !x.isoDate),
          '缺日期的後面又冒出有日期的',
        ).toBe(true);
      }),
    );
  });

  it('搜尋不會改變剩下那些項目的相對順序（同一種排序下）', () => {
    fc.assert(
      fc.property(fc.array(watchArb, { maxLength: 25 }), fc.string({ maxLength: 2 }), (list, term) => {
        const all = filterAndSortWatchItems(list, '', 'titleAsc');
        const some = filterAndSortWatchItems(list, term, 'titleAsc');
        const expected = all.filter((x) => some.includes(x));
        expect(some).toEqual(expected);
      }),
    );
  });
});
