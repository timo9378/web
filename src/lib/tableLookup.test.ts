import { describe, expect, it } from 'vitest';
import { lookup, lookupOr } from './tableLookup';

// 這兩個函式存在的理由是「key 是執行期字串，表不保證有」——
// 也就是說它們的整個價值就在「查不到的時候行為正確」。所以測試重心全在落空的路徑。

const TABLE: Record<string, number> = { a: 1, b: 2 };

describe('lookup', () => {
  it('有就回值', () => {
    expect(lookup(TABLE, 'a')).toBe(1);
  });

  it('沒有回 undefined', () => {
    expect(lookup(TABLE, 'zzz')).toBeUndefined();
  });

  // 這條是實際修掉的 bug：直接索引會取到 Object.prototype 上的東西。
  // key 的來源是 DB 的 role/status、URL 的 locale 這類外部字串，撞得到。
  it('不會取到原型鏈上的屬性', () => {
    expect(lookup(TABLE, 'toString')).toBeUndefined();
    expect(lookup(TABLE, 'constructor')).toBeUndefined();
    expect(lookup(TABLE, 'hasOwnProperty')).toBeUndefined();
    expect(lookup(TABLE, '__proto__')).toBeUndefined();
  });

  it('值本身是 undefined 跟「沒這個 key」分不出來，這是可以接受的', () => {
    const withUndefined: Record<string, number | undefined> = { x: undefined };
    expect(lookup(withUndefined, 'x')).toBeUndefined();
  });

  it('值是 falsy 的時候照回，不會被當成查不到', () => {
    const falsy: Record<string, number | string | boolean> = { zero: 0, empty: '', no: false };
    expect(lookup(falsy, 'zero')).toBe(0);
    expect(lookup(falsy, 'empty')).toBe('');
    expect(lookup(falsy, 'no')).toBe(false);
  });
});

describe('lookupOr', () => {
  it('查不到用 fallback', () => {
    expect(lookupOr(TABLE, 'zzz', 99)).toBe(99);
  });

  it('原型鏈上的名字也要走 fallback，否則會回一個函式', () => {
    expect(lookupOr(TABLE, 'toString', 99)).toBe(99);
  });

  it('falsy 的值不會被 fallback 蓋掉（用的是 ?? 不是 ||）', () => {
    expect(lookupOr({ zero: 0 }, 'zero', 99)).toBe(0);
    expect(lookupOr({ no: false }, 'no', true)).toBe(false);
  });
});
