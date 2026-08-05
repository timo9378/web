import { describe, expect, it } from 'vitest';
import { trackAnalytics } from './trackAnalytics';

// Music.tsx 的統計聚合。這種東西壞掉的樣子是「數字看起來很合理但其實是錯的」——
// 平均年份差十年、比例的小數點位置不對，畫面上都只是一個數字，沒有人會發現。

const track = (o: { pop?: number; ms?: number; explicit?: boolean; date?: string } = {}) => ({
  popularity: o.pop ?? 50,
  duration_ms: o.ms ?? 200_000,
  explicit: o.explicit ?? false,
  album: { release_date: o.date ?? '2020-01-01' },
});

describe('trackAnalytics', () => {
  it('沒有曲目時回 null（呼叫端據此整區不渲染，而不是畫一堆 0）', () => {
    expect(trackAnalytics([])).toBeNull();
    expect(trackAnalytics(null)).toBeNull();
    expect(trackAnalytics(undefined)).toBeNull();
  });

  it('平均人氣與平均長度四捨五入', () => {
    const r = trackAnalytics([track({ pop: 10, ms: 100 }), track({ pop: 11, ms: 101 })]);
    expect(r?.avgPopularity).toBe(11); // 10.5 → 11
    expect(r?.avgDurationMs).toBe(101); // 100.5 → 101
  });

  it('explicit 的數量與比例', () => {
    const r = trackAnalytics([track({ explicit: true }), track(), track(), track()]);
    expect(r?.explicitCount).toBe(1);
    expect(r?.explicitRatio).toBe(0.25);
    expect(r?.totalTracks).toBe(4);
  });

  it('全部都是 explicit 時比例是 1，全都不是時是 0', () => {
    expect(trackAnalytics([track({ explicit: true })])?.explicitRatio).toBe(1);
    expect(trackAnalytics([track()])?.explicitRatio).toBe(0);
  });

  it('平均年份取自 release_date 的前四碼', () => {
    const r = trackAnalytics([track({ date: '2000-01-01' }), track({ date: '2020-01-01' })]);
    expect(r?.avgYear).toBe(2010);
  });

  // Spotify 的 release_date 精度不一定（2020 / 2020-05 / 2020-05-01），
  // 所以只能切前四碼。解析不出來的要**跳過**，當成 0 的話平均年份會被拉到接近 0。
  it('release_date 只有年份或年月都解析得出來', () => {
    const r = trackAnalytics([track({ date: '1999' }), track({ date: '2001-06' })]);
    expect(r?.avgYear).toBe(2000);
  });

  it('解析不出年份的跳過，不會被當成 0 拉低平均', () => {
    const r = trackAnalytics([track({ date: '2020-01-01' }), track({ date: '' }), track({ date: '未知' })]);
    expect(r?.avgYear).toBe(2020);
    expect(r?.decades).toEqual([{ decade: '2020s', count: 1 }]);
  });

  it('一首都解析不出年份時 avgYear 是 null，不是 NaN 或 0', () => {
    const r = trackAnalytics([track({ date: 'unknown' })]);
    expect(r?.avgYear).toBeNull();
    expect(r?.decades).toEqual([]);
  });

  it('年代分佈依年代升冪，數量正確', () => {
    const r = trackAnalytics([
      track({ date: '2005-01-01' }),
      track({ date: '1998-01-01' }),
      track({ date: '2001-01-01' }),
      track({ date: '1995-01-01' }),
    ]);
    expect(r?.decades).toEqual([
      { decade: '1990s', count: 2 },
      { decade: '2000s', count: 2 },
    ]);
  });

  it('年代的邊界：1999 是 1990s、2000 是 2000s', () => {
    const r = trackAnalytics([track({ date: '1999' }), track({ date: '2000' })]);
    expect(r?.decades).toEqual([
      { decade: '1990s', count: 1 },
      { decade: '2000s', count: 1 },
    ]);
  });

  it('只有一首時每個欄位都成立', () => {
    const r = trackAnalytics([track({ pop: 77, ms: 123_456, explicit: true, date: '2011-03-02' })]);
    expect(r).toEqual({
      avgPopularity: 77,
      avgDurationMs: 123_456,
      explicitRatio: 1,
      explicitCount: 1,
      totalTracks: 1,
      avgYear: 2011,
      decades: [{ decade: '2010s', count: 1 }],
    });
  });
});
