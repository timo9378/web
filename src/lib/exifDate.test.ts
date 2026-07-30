import { describe, expect, it } from 'vitest';
import { exifDateTimeText, exifMonthDay, exifYear, exifYmd, parseExifWallClock } from './exifDate';

// 三種格式：目標格式（帶相機時區）＋兩種歷史格式（見 exifDate.ts 的說明）。
const OFFSET = '2023-04-27T10:56:22+08:00'; // backfill 後的目標格式
const EXIFTOOL = '2023:04:27 10:56:22'; // 舊 Node builder
const NAIVE = '2022-08-07T09:59:14'; // 相機沒寫 OffsetTime* 的那種
const ISO_Z = '2025-07-27T21:45:09.000Z'; // 舊 Rust 版（時區是捏造的）

describe('parseExifWallClock', () => {
  it('帶時區：取字面的牆上時間，offset 另外留著', () => {
    expect(parseExifWallClock(OFFSET)).toEqual({
      year: 2023, month: 4, day: 27, hour: 10, minute: 56, second: 22, offset: '+08:00',
    });
  });

  it('exiftool 格式：new Date 解不開的那種，這裡照樣拿到牆上時間', () => {
    expect(new Date(EXIFTOOL).getTime()).toBeNaN(); // 這就是原本壞掉的原因
    expect(parseExifWallClock(EXIFTOOL)).toMatchObject({ year: 2023, month: 4, day: 27, hour: 10 });
  });

  it('沒有時區的裸時間：offset 是 null，不捏造', () => {
    expect(parseExifWallClock(NAIVE)).toMatchObject({ year: 2022, month: 8, day: 7, offset: null });
  });

  it('空值與亂字串回 null', () => {
    for (const v of [undefined, null, '', '不是日期', '2023-04-27']) {
      expect(parseExifWallClock(v)).toBeNull();
    }
  });

  it('結構對但日期不存在的也回 null（不是印出 "13/99" 或靜靜滾成別天）', () => {
    for (const v of ['2023-13-01T10:00:00', '2023-02-30T10:00:00', '2023-04-27T25:00:00']) {
      expect(parseExifWallClock(v)).toBeNull();
    }
    expect(parseExifWallClock('2024-02-29T10:00:00')).not.toBeNull(); // 閏年 2/29 是真的
  });
});

describe('顯示用的格式化', () => {
  it('拍攝日期不會跟著看的人的時區跑', () => {
    // 這是 backfill 帶進來的風險：`new Date("…+08:00")` 是絕對時刻，
    // 用 UTC-8 的瀏覽器看會變成前一天。牆上時間就不會。
    expect(exifMonthDay(OFFSET)).toBe('04/27');
    expect(exifYear(OFFSET)).toBe('2023');
    expect(exifYmd(OFFSET)).toBe('2023/04/27');
    expect(exifDateTimeText(OFFSET)).toContain('2023/04/27');
    expect(exifDateTimeText(OFFSET)).toContain('10:56');
  });

  it('exiftool 與帶時區版指的是同一刻，顯示也要一致（backfill 前後不能變樣）', () => {
    for (const f of [exifMonthDay, exifYear, exifYmd, exifDateTimeText]) {
      expect(f(EXIFTOOL)).toBe(f(OFFSET));
    }
  });

  it('ISO_Z 這種歷史格式仍解得出東西（不 Invalid Date）', () => {
    expect(exifYear(ISO_Z)).toMatch(/^\d{4}$/);
    expect(exifMonthDay(ISO_Z)).toMatch(/^\d{2}\/\d{2}$/);
  });

  it('解不出來一律空字串 / null（呼叫端靠這個退回 title）', () => {
    for (const f of [exifMonthDay, exifYear, exifYmd]) expect(f(null)).toBe('');
    expect(exifDateTimeText(null)).toBeNull();
  });
});
