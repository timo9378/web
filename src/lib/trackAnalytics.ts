// Spotify 熱門曲目的統計聚合。從 Music.tsx（666 statements @ 14%）抽出來。
//
// 這種聚合壞掉的樣子是「數字看起來很合理但其實是錯的」——平均年份差十年、
// explicit 比例算成小數點位置不對，畫面上都只是一個數字，沒有人會發現。

export interface TrackLike {
  popularity: number;
  duration_ms: number;
  explicit: boolean;
  album: { release_date: string };
}

export interface TrackAnalytics {
  avgPopularity: number;
  avgDurationMs: number;
  /** 0~1 */
  explicitRatio: number;
  explicitCount: number;
  totalTracks: number;
  /** 沒有任何一首解析得出年份時是 null */
  avgYear: number | null;
  /** 依年代字串升冪，例如 [{ decade: '1990s', count: 2 }, …] */
  decades: { decade: string; count: number }[];
}

/**
 * 算一組曲目的統計。空清單回 `null`（呼叫端據此整區不渲染，而不是畫一堆 0）。
 *
 * ⚠ 年份取自 `album.release_date` 的前四碼。Spotify 的這個欄位精度不一定
 * （可能是 `2020`、`2020-05`、`2020-05-01`），所以只能切前四碼再 parseInt；
 * 解析不出來的就不算進平均與年代分佈，而不是當成 0——否則平均年份會被拉到接近 0。
 */
export function trackAnalytics(tracks: readonly TrackLike[] | null | undefined): TrackAnalytics | null {
  if (!tracks || tracks.length === 0) return null;
  const n = tracks.length;

  let totalPopularity = 0;
  let totalDuration = 0;
  let explicitCount = 0;
  const years: number[] = [];
  for (const t of tracks) {
    totalPopularity += t.popularity;
    totalDuration += t.duration_ms;
    if (t.explicit) explicitCount++;
    const y = Number.parseInt(t.album.release_date.slice(0, 4), 10);
    if (!Number.isNaN(y)) years.push(y);
  }

  const decadeMap = new Map<string, number>();
  for (const y of years) {
    const dec = `${Math.floor(y / 10) * 10}s`;
    decadeMap.set(dec, (decadeMap.get(dec) ?? 0) + 1);
  }

  return {
    avgPopularity: Math.round(totalPopularity / n),
    avgDurationMs: Math.round(totalDuration / n),
    explicitRatio: explicitCount / n,
    explicitCount,
    totalTracks: n,
    avgYear: years.length ? Math.round(years.reduce((s, y) => s + y, 0) / years.length) : null,
    decades: [...decadeMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([decade, count]) => ({ decade, count })),
  };
}
