import { describe, expect, it } from 'vitest';
import { dedupeWatchItems, filterAndSortBooks, filterAndSortWatchItems } from './mediaLists';

// 書櫃 511 statements @ 19%、片庫 298 @ 16%。這兩支的失敗模式一樣：
// 畫面上仍然是一份看起來正常的清單，只有真的去數才知道少了東西或順序不對。
// e2e 驗得了「篩完會變少」，驗不動「篩掉的是不是該篩的那些」——那要靠這裡。

describe('filterAndSortBooks', () => {
  const book = (o: Partial<Parameters<typeof filterAndSortBooks>[0][number]> & { title: string }) => ({
    authors: null,
    reading_status: 'read',
    rating: null,
    date_added: null,
    published_date: null,
    ...o,
  });
  const BOOKS = [
    book({ title: 'Zero to One', authors: 'Peter Thiel', reading_status: 'read', rating: 3, date_added: '2026-01-01' }),
    book({ title: '海邊的卡夫卡', authors: '村上春樹', reading_status: 'to-read', date_added: '2026-03-01' }),
    book({ title: '測試書名', authors: '某作者', reading_status: 'read', rating: 5, date_added: '2026-02-01' }),
  ];
  const ALL = { searchTerm: '', statusFilter: 'all', ratingFilter: 'all', sortBy: '' };
  const titles = (r: { title: string }[]) => r.map((b) => b.title);

  it('沒有任何條件時原樣回傳，而且不動到傳進來的陣列', () => {
    const input = [...BOOKS];
    expect(filterAndSortBooks(input, ALL)).toHaveLength(3);
    expect(input).toEqual(BOOKS);
  });

  it('搜尋同時比對書名與作者，不分大小寫', () => {
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, searchTerm: 'zero' }))).toEqual(['Zero to One']);
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, searchTerm: '村上' }))).toEqual(['海邊的卡夫卡']);
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, searchTerm: 'THIEL' }))).toEqual(['Zero to One']);
  });

  it('作者是 null 的書不會讓搜尋炸掉', () => {
    const b = [book({ title: '無作者', authors: null })];
    expect(filterAndSortBooks(b, { ...ALL, searchTerm: '無' })).toHaveLength(1);
    expect(filterAndSortBooks(b, { ...ALL, searchTerm: 'x' })).toHaveLength(0);
  });

  it('狀態與星等各自篩得動，也篩得起來一起用', () => {
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, statusFilter: 'to-read' }))).toEqual(['海邊的卡夫卡']);
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, ratingFilter: '5' }))).toEqual(['測試書名']);
    expect(filterAndSortBooks(BOOKS, { ...ALL, statusFilter: 'read', ratingFilter: '5' })).toHaveLength(1);
    // 條件互斥時是空的，不是「其中一個」
    expect(filterAndSortBooks(BOOKS, { ...ALL, statusFilter: 'to-read', ratingFilter: '5' })).toHaveLength(0);
  });

  it('沒評分的書不會被星等篩選誤當成 0 分', () => {
    expect(filterAndSortBooks(BOOKS, { ...ALL, ratingFilter: '0' })).toHaveLength(0);
  });

  it('書名排序的升冪與降冪互為顛倒', () => {
    const asc = titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: 'title_asc' }));
    const desc = titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: 'title_desc' }));
    expect(desc).toEqual([...asc].reverse());
  });

  it('加入日期排序', () => {
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: 'date_added_asc' }))).toEqual([
      'Zero to One',
      '測試書名',
      '海邊的卡夫卡',
    ]);
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: 'date_added_desc' }))).toEqual([
      '海邊的卡夫卡',
      '測試書名',
      'Zero to One',
    ]);
  });

  // 這條是重點：原本用 `new Date(a.date_added ?? '').getTime()` 相減，
  // 缺日期時得到 NaN，而 comparator 回傳 NaN 在規格上是未定義行為——
  // 同一批資料每次排出來可能不一樣。改成字串比對 + 缺值排最後之後是確定性的。
  it('缺日期的一律排最後，升冪降冪都是，而且結果穩定', () => {
    const mixed = [
      book({ title: '沒日期A' }),
      book({ title: '有日期', date_added: '2026-01-01' }),
      book({ title: '沒日期B' }),
    ];
    for (const sortBy of ['date_added_asc', 'date_added_desc']) {
      const r = titles(filterAndSortBooks(mixed, { ...ALL, sortBy }));
      expect(r[0], sortBy).toBe('有日期');
      expect(r.slice(1).sort(), sortBy).toEqual(['沒日期A', '沒日期B']);
    }
    // 跑兩次結果一樣（NaN comparator 的症狀就是這裡會飄）
    const once = titles(filterAndSortBooks(mixed, { ...ALL, sortBy: 'date_added_asc' }));
    const twice = titles(filterAndSortBooks(mixed, { ...ALL, sortBy: 'date_added_asc' }));
    expect(once).toEqual(twice);
  });

  it('沒評分的書在評分排序裡當 0 分（排最後）', () => {
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: 'rating_desc' }))).toEqual([
      '測試書名',
      'Zero to One',
      '海邊的卡夫卡',
    ]);
  });

  it('不認得的排序值不會改變順序，也不會炸', () => {
    expect(titles(filterAndSortBooks(BOOKS, { ...ALL, sortBy: '不存在的排序' }))).toEqual(titles(BOOKS));
  });

  it('空清單不會炸', () => {
    expect(filterAndSortBooks([], { ...ALL, searchTerm: 'x', sortBy: 'title_asc' })).toEqual([]);
  });
});

describe('dedupeWatchItems', () => {
  const item = (title: string, tmdbId: number | null, epCount: number | null) => ({ title, tmdbId, epCount });

  it('同一個 tmdbId 只留集數最多的那筆', () => {
    const { anime, tv } = dedupeWatchItems([item('進擊 動畫版', 1429, 25)], [item('進擊 影集版', 1429, 12)]);
    expect(anime.map((x) => x.title)).toEqual(['進擊 動畫版']);
    expect(tv).toEqual([]);
  });

  it('贏家在哪個清單就留在哪個清單', () => {
    const { anime, tv } = dedupeWatchItems([item('動畫少', 7, 3)], [item('影集多', 7, 30)]);
    expect(anime).toEqual([]);
    expect(tv.map((x) => x.title)).toEqual(['影集多']);
  });

  // 用標題比對會誤殺劇場版／同名不同季／不同語系譯名，
  // 而那種誤殺是「某部作品從清單上消失」，比留下重複難發現得多。
  it('沒有 tmdbId 的一律不去重，就算標題一模一樣', () => {
    const { anime, tv } = dedupeWatchItems([item('同名', null, 1)], [item('同名', null, 99)]);
    expect(anime).toHaveLength(1);
    expect(tv).toHaveLength(1);
  });

  it('集數相同時保留先出現的（anime 在前），結果是確定的', () => {
    const { anime, tv } = dedupeWatchItems([item('A', 5, 10)], [item('B', 5, 10)]);
    expect(anime.map((x) => x.title)).toEqual(['A']);
    expect(tv).toEqual([]);
  });

  it('epCount 是 null 的當成 0，不會贏過有集數的', () => {
    const { anime, tv } = dedupeWatchItems([item('沒集數', 9, null)], [item('有集數', 9, 1)]);
    expect(anime).toEqual([]);
    expect(tv.map((x) => x.title)).toEqual(['有集數']);
  });

  it('同一個清單內部的重複也會去掉', () => {
    const { anime } = dedupeWatchItems([item('少', 3, 2), item('多', 3, 20)], []);
    expect(anime.map((x) => x.title)).toEqual(['多']);
  });

  it('不同 tmdbId 一個都不會少', () => {
    const { anime, tv } = dedupeWatchItems([item('a', 1, 1), item('b', 2, 1)], [item('c', 3, 1)]);
    expect(anime).toHaveLength(2);
    expect(tv).toHaveLength(1);
  });

  it('空清單不會炸', () => {
    expect(dedupeWatchItems([], [])).toEqual({ anime: [], tv: [] });
  });
});

describe('filterAndSortWatchItems', () => {
  const it_ = (title: string, isoDate: string | null) => ({ title, isoDate, tmdbId: null, epCount: null });
  const LIST = [it_('Angel Beats', '2026-01-03'), it_('測試動畫', '2026-01-11'), it_('另一部動畫', '2026-01-06')];
  const titles = (r: { title: string }[]) => r.map((x) => x.title);

  it('搜尋只比標題，不分大小寫，前後空白會修掉', () => {
    expect(titles(filterAndSortWatchItems(LIST, 'angel', 'newest'))).toEqual(['Angel Beats']);
    expect(titles(filterAndSortWatchItems(LIST, '  測試  ', 'newest'))).toEqual(['測試動畫']);
  });

  it('搜尋不到是空陣列', () => {
    expect(filterAndSortWatchItems(LIST, '不存在的片名', 'newest')).toEqual([]);
  });

  it('最新與最舊互為顛倒', () => {
    const newest = titles(filterAndSortWatchItems(LIST, '', 'newest'));
    const oldest = titles(filterAndSortWatchItems(LIST, '', 'oldest'));
    expect(newest).toEqual(['測試動畫', '另一部動畫', 'Angel Beats']);
    expect(oldest).toEqual([...newest].reverse());
  });

  it('標題升冪與降冪互為顛倒', () => {
    const asc = titles(filterAndSortWatchItems(LIST, '', 'titleAsc'));
    expect(titles(filterAndSortWatchItems(LIST, '', 'titleDesc'))).toEqual([...asc].reverse());
  });

  it('沒有日期的一律排最後——「最舊」也一樣', () => {
    const mixed = [it_('沒日期', null), it_('有日期', '2026-01-01')];
    expect(titles(filterAndSortWatchItems(mixed, '', 'newest'))).toEqual(['有日期', '沒日期']);
    expect(titles(filterAndSortWatchItems(mixed, '', 'oldest'))).toEqual(['有日期', '沒日期']);
  });

  it('不動到傳進來的陣列', () => {
    const input = [...LIST];
    filterAndSortWatchItems(input, '', 'titleAsc');
    expect(input).toEqual(LIST);
  });

  it('不認得的排序值退回「最新」', () => {
    expect(titles(filterAndSortWatchItems(LIST, '', '亂寫的'))).toEqual(
      titles(filterAndSortWatchItems(LIST, '', 'newest')),
    );
  });
});
