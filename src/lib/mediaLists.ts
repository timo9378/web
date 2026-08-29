// 收藏庫清單的純邏輯：書櫃的篩選排序、片庫的跨來源去重與排序。
//
// 從 Bookshelf.tsx（511 statements @ 19%）與 WatchLibrary.tsx（298 @ 16%）抽出來。
// 這兩支的共通失敗模式是「篩掉了不該篩的、或排出來的順序不對」——畫面上仍然是一份
// 看起來正常的清單，沒有任何錯誤訊息，只有真的去數才會發現少了東西。

/* ══════════════ 書櫃 ══════════════ */

export interface BookLike {
  title: string;
  authors?: string | null;
  reading_status?: string | null;
  rating?: number | null;
  date_added?: string | null;
  published_date?: string | null;
}

export interface BookFilters {
  searchTerm: string;
  /** 'all' 或某個 reading_status */
  statusFilter: string;
  /** 'all' 或星等的字串（表單來的） */
  ratingFilter: string;
  sortBy: string;
}

/** 缺日期的一律排最後（不管升冪或降冪）。 */
function missingLast(a: string, b: string): number | null {
  if (a && b) return null;
  return (a ? 0 : 1) - (b ? 0 : 1);
}

/**
 * 書櫃的搜尋 → 狀態 → 星等 → 排序。
 *
 * 搜尋同時比對書名與作者，兩邊都不分大小寫。
 *
 * ⚠ 日期排序刻意不用 `new Date(x).getTime()` 相減。`date_added` 可以是 null，
 * 而 `new Date('').getTime()` 是 **NaN**——comparator 回傳 NaN 在規格上是未定義行為，
 * 實際結果隨引擎與陣列長度而變，也就是「同一批資料每次排出來可能不一樣」。
 * 改成字串比對 + 缺值排最後，跟片庫那邊的處理一致，而且是確定性的。
 * （ISO 8601 的字串序等同時間序，所以不需要轉成 Date。）
 */
export function filterAndSortBooks<T extends BookLike>(books: readonly T[], f: BookFilters): T[] {
  let out = [...books];

  if (f.searchTerm) {
    const term = f.searchTerm.toLowerCase();
    out = out.filter((b) => b.title.toLowerCase().includes(term) || (b.authors?.toLowerCase().includes(term) ?? false));
  }
  if (f.statusFilter !== 'all') out = out.filter((b) => b.reading_status === f.statusFilter);
  if (f.ratingFilter !== 'all') {
    const want = Number.parseInt(f.ratingFilter, 10);
    out = out.filter((b) => b.rating === want);
  }

  out.sort((a, b) => {
    switch (f.sortBy) {
      case 'date_added_asc': {
        const ad = a.date_added ?? '';
        const bd = b.date_added ?? '';
        return missingLast(ad, bd) ?? ad.localeCompare(bd);
      }
      case 'date_added_desc': {
        const ad = a.date_added ?? '';
        const bd = b.date_added ?? '';
        return missingLast(ad, bd) ?? bd.localeCompare(ad);
      }
      case 'title_asc':
        return a.title.localeCompare(b.title);
      case 'title_desc':
        return b.title.localeCompare(a.title);
      case 'rating_desc':
        return (b.rating ?? 0) - (a.rating ?? 0);
      case 'published_date_desc':
        return (b.published_date ?? '').localeCompare(a.published_date ?? '');
      default:
        return 0;
    }
  });

  return out;
}

/* ══════════════ 片庫 ══════════════ */

export interface WatchLike {
  title: string;
  tmdbId?: number | string | null;
  epCount?: number | null;
  isoDate?: string | null;
}

/**
 * 跨「動畫（Bahamut）／影集（Netflix、Simkl）」去重：同一個 tmdbId 視為同一部，
 * 只保留**集數最多**的那筆。
 *
 * ⚠ 沒有 tmdbId 的一律不去重。用標題比對會誤殺——劇場版與本篇、同名不同季、
 * 不同語系的譯名都會撞在一起，而那種誤殺是「某部作品從清單上消失」，
 * 比留下重複難發現得多。
 *
 * 集數相同時保留**先出現**的（比較用 `>` 而不是 `>=`），所以結果只跟輸入順序有關，
 * 是確定性的。
 */
export function dedupeWatchItems<T extends WatchLike>(anime: readonly T[], tv: readonly T[]): { anime: T[]; tv: T[] } {
  const winner = new Map<number | string, T>();
  for (const it of [...anime, ...tv]) {
    if (it.tmdbId == null) continue;
    const cur = winner.get(it.tmdbId);
    if (!cur || (it.epCount ?? 0) > (cur.epCount ?? 0)) winner.set(it.tmdbId, it);
  }
  const keep = (it: T) => it.tmdbId == null || winner.get(it.tmdbId) === it;
  return { anime: anime.filter(keep), tv: tv.filter(keep) };
}

/**
 * 片庫的搜尋（只比標題）與排序。
 *
 * 沒有日期的一律排最後——不管是「最新」還是「最舊」。把它們排在「最舊」的最前面
 * 看起來像資料錯亂，而使用者要的是「我最早看的那部」。
 */
export function filterAndSortWatchItems<T extends WatchLike>(list: readonly T[], search: string, sortBy: string): T[] {
  const term = search.trim().toLowerCase();
  const filtered = term ? list.filter((it) => it.title.toLowerCase().includes(term)) : [...list];
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    const ad = a.isoDate ?? '';
    const bd = b.isoDate ?? '';
    switch (sortBy) {
      case 'titleAsc':
        return a.title.localeCompare(b.title);
      case 'titleDesc':
        return b.title.localeCompare(a.title);
      case 'oldest':
        return missingLast(ad, bd) ?? ad.localeCompare(bd);
      default:
        return missingLast(ad, bd) ?? bd.localeCompare(ad);
    }
  });
  return sorted;
}
