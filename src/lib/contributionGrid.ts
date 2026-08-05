// GitHub 貢獻熱力圖的格子計算，以及站台運行時間。
//
// 從 Activity.tsx（754 statements @ 10%，全站 e2e 覆蓋率最低的檔）抽出來。
// 熱力圖有兩條路徑：優先用 `/api/github/contributions` 的日曆，抓不到才從 push events
// 硬推。兩條路徑產出的東西必須長得一樣，否則 API 一掛畫面就換一種樣子——
// 而那不會有任何錯誤訊息。

export interface ContributionCell {
  date: string;
  count: number;
  /** 0~4 是顏色深淺；-1 是補滿最後一週用的空格。 */
  level: number;
}

/**
 * 官方日曆的深淺分級。
 *
 * ⚠ 跟下面 events 版的門檻**故意不同**（那邊是 2/5/8）：events 只看得到公開 push，
 * 數字天生偏低，用同一組門檻的話整張圖會比實際淡一階。
 */
function levelFromCalendar(count: number): number {
  if (count === 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

function levelFromEvents(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 8) return 3;
  return 4;
}

export interface ContributionDay {
  date: string;
  count?: number | null;
}

/**
 * 從 `/api/github/contributions` 的日曆排成「一欄一週」的格子。
 *
 * 輸入是**依日期升冪**的一維陣列。輸出 `grid[週][該週的第幾天]`，兩個維度都是
 * 舊 → 新（跟 GitHub 自己的排法一致）。最後一週不滿七天時用 `level: -1` 的空格補滿，
 * 讓每一欄的高度一致。
 */
export function gridFromContributions(contributions: readonly ContributionDay[]): ContributionCell[][] {
  const grid: ContributionCell[][] = [];
  const totalWeeks = Math.ceil(contributions.length / 7);
  for (let w = 0; w < totalWeeks; w++) {
    const week: ContributionCell[] = [];
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      if (idx < contributions.length) {
        const day = contributions[idx];
        const count = day.count ?? 0;
        week.push({ date: day.date, count, level: levelFromCalendar(count) });
      } else {
        week.push({ date: '', count: 0, level: -1 });
      }
    }
    grid.push(week);
  }
  return grid;
}

export interface PushEventLike {
  type: string;
  created_at: string;
  payload: { commits: readonly unknown[] };
}

/**
 * 後備路徑：從 push events 硬推最近 52 週的格子。
 *
 * ⚠ 這裡修掉一個**兩軸都反向**的 bug。原本的實作是
 * `for (week = 51; week >= 0; week--)` 先推最舊的、最後 `data.reverse()`，
 * 於是週變成「新 → 舊」；內層 `day` 遞增代表往回推一天，於是日也變成「新 → 舊」。
 * 而 `gridFromContributions` 兩軸都是「舊 → 新」——也就是說 **API 一掛掉，
 * 熱力圖就整張鏡像過來**。渲染端只是單純的雙層 map，沒有再反轉一次，
 * tooltip 的日期又還是對的，所以這件事在畫面上非常難察覺。
 *
 * 現在兩條路徑的方向一致。
 *
 * ⚠ `now` 由呼叫端傳入而不是在函式裡取 —— 這樣才測得動。
 * 日期用 `toDateString()`（本地時區）分組與顯示，跟原本一致：換成 ISO 會改變
 * 「一筆 commit 算在哪一天」，那是行為變更而不是排版修正。
 */
export function gridFromEvents(events: readonly PushEventLike[], now: Date): ContributionCell[][] {
  const commitsByDate: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== 'PushEvent') continue;
    const key = new Date(e.created_at).toDateString();
    commitsByDate[key] = (commitsByDate[key] ?? 0) + e.payload.commits.length;
  }

  const grid: ContributionCell[][] = [];
  // 週：舊 → 新。日：同一週內也是舊 → 新。
  for (let week = 51; week >= 0; week--) {
    const days: ContributionCell[] = [];
    for (let day = 6; day >= 0; day--) {
      const d = new Date(now);
      d.setDate(d.getDate() - (week * 7 + day));
      const key = d.toDateString();
      const count = commitsByDate[key] ?? 0;
      days.push({ date: key, count, level: levelFromEvents(count) });
    }
    grid.push(days);
  }
  return grid;
}

/** 站台已經跑了多久。`now` 傳入才測得動。 */
export function uptimeSince(start: Date, now: Date): { days: number; hours: number } {
  const diff = Math.abs(now.getTime() - start.getTime());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
  };
}
