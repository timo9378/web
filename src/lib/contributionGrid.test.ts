import { describe, expect, it } from 'vitest';
import { gridFromContributions, gridFromEvents, uptimeSince } from './contributionGrid';

// Activity.tsx 是全站 e2e 覆蓋率最低的檔（754 statements @ 10%）。
// 熱力圖的兩條路徑（官方日曆 / 從 push events 硬推）必須產出同一種形狀，
// 否則 API 一掛畫面就換一種樣子——而那不會有任何錯誤訊息。

const day = (date: string, count: number) => ({ date, count });

describe('gridFromContributions', () => {
  it('每七天一欄，兩軸都是舊 → 新', () => {
    const days = Array.from({ length: 14 }, (_, i) => day(`2026-01-${String(i + 1).padStart(2, '0')}`, 0));
    const grid = gridFromContributions(days);
    expect(grid).toHaveLength(2);
    expect(grid[0].map((c) => c.date)).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07',
    ]);
    expect(grid[1][0].date).toBe('2026-01-08');
  });

  it('最後一週不滿七天時用 level -1 的空格補滿，欄高才會一致', () => {
    const grid = gridFromContributions([day('2026-01-01', 1), day('2026-01-02', 1)]);
    expect(grid[0]).toHaveLength(7);
    expect(grid[0].slice(2).every((c) => c.level === -1 && c.date === '')).toBe(true);
  });

  it('深淺分級：0 / 1-3 / 4-6 / 7-9 / 10+', () => {
    const counts = [0, 1, 3, 4, 6, 7, 9, 10, 999];
    const grid = gridFromContributions(counts.map((c, i) => day(`d${i}`, c)));
    expect(grid[0].concat(grid[1]).slice(0, 9).map((c) => c.level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('count 是 null 或缺席時當 0', () => {
    const grid = gridFromContributions([{ date: 'a' }, { date: 'b', count: null }]);
    expect(grid[0].slice(0, 2).map((c) => c.count)).toEqual([0, 0]);
  });

  it('空輸入回空陣列', () => {
    expect(gridFromContributions([])).toEqual([]);
  });
});

describe('gridFromEvents', () => {
  const NOW = new Date('2026-01-14T12:00:00');
  const push = (created_at: string, commits: number) => ({
    type: 'PushEvent',
    created_at,
    payload: { commits: Array.from({ length: commits }, () => ({})) },
  });

  it('固定 52 欄 × 7 天', () => {
    const grid = gridFromEvents([], NOW);
    expect(grid).toHaveLength(52);
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  // 這條是重點：原本的實作週與日**都是反向**的，跟 gridFromContributions 相反，
  // 於是 API 一掛掉熱力圖就整張鏡像過來。渲染端只是單純的雙層 map，
  // tooltip 的日期又還是對的，所以在畫面上非常難察覺。
  it('兩軸都是舊 → 新，跟官方日曆那條路徑一致', () => {
    const grid = gridFromEvents([], NOW);
    const first = new Date(grid[0][0].date).getTime();
    const last = new Date(grid[51][6].date).getTime();
    expect(first, '第一欄第一格應該最舊').toBeLessThan(last);

    // 同一欄之內也要是舊 → 新
    const week = grid[10].map((c) => new Date(c.date).getTime());
    expect(week).toEqual([...week].sort((a, b) => a - b));

    // 最後一格就是 now 當天
    expect(grid[51][6].date).toBe(NOW.toDateString());
  });

  it('同一天的多筆 push 會累加 commit 數', () => {
    const d = '2026-01-13T09:00:00';
    const grid = gridFromEvents([push(d, 2), push('2026-01-13T18:00:00', 3)], NOW);
    const cell = grid.flat().find((c) => c.date === new Date(d).toDateString());
    expect(cell?.count).toBe(5);
  });

  it('非 PushEvent 一律忽略', () => {
    const grid = gridFromEvents(
      [{ type: 'WatchEvent', created_at: '2026-01-13T09:00:00', payload: { commits: [{}, {}] } }],
      NOW,
    );
    expect(grid.flat().every((c) => c.count === 0)).toBe(true);
  });

  it('深淺分級比官方那組低一階（events 只看得到公開 push，天生偏低）', () => {
    const at = (n: number) => {
      const grid = gridFromEvents([push('2026-01-13T09:00:00', n)], NOW);
      return grid.flat().find((c) => c.date === new Date('2026-01-13T09:00:00').toDateString())?.level;
    };
    expect([at(1), at(2), at(3), at(5), at(6), at(8), at(9)]).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('超出 52 週的事件不會出現在格子裡', () => {
    const grid = gridFromEvents([push('2020-01-01T00:00:00', 50)], NOW);
    expect(grid.flat().every((c) => c.count === 0)).toBe(true);
  });
});

describe('uptimeSince', () => {
  it('算出天數與剩餘小時', () => {
    expect(uptimeSince(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-03T05:30:00Z')))
      .toEqual({ days: 2, hours: 5 });
  });

  it('同一時刻是 0 天 0 小時', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(uptimeSince(t, t)).toEqual({ days: 0, hours: 0 });
  });

  it('起訖顛倒也回正數（取絕對值）', () => {
    expect(uptimeSince(new Date('2026-01-03T00:00:00Z'), new Date('2026-01-01T00:00:00Z')).days).toBe(2);
  });
});
