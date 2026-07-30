import { describe, expect, it } from 'vitest';
import { exifMonthDay, exifYear, exifYmd, parseExifDate } from './exifDate';

// 樣本取自線上 manifest 的兩種實際格式（246 筆 exiftool、1 筆 ISO）。
// 這個檔案存在的原因就是那個分裂：每個解析點以前都只吃得下其中一種。
const EXIFTOOL = '2023:04:27 10:56:22';
const ISO = '2025-07-27T21:45:09.000Z';

describe('parseExifDate', () => {
  it('吃得下 exiftool 的 "YYYY:MM:DD hh:mm:ss"（new Date 直接給 Invalid Date 的那種）', () => {
    expect(new Date(EXIFTOOL).getTime()).toBeNaN(); // 這就是原本壞掉的原因
    const d = parseExifDate(EXIFTOOL);
    expect(d).not.toBeNull();
    // 沒有時區 → 當地時間；用 getFullYear 等當地取值來斷言才不會被跑測試的 TZ 影響
    expect(d && [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2023, 4, 27, 10]);
  });

  it('也吃得下 ISO', () => {
    expect(parseExifDate(ISO)?.toISOString()).toBe('2025-07-27T21:45:09.000Z');
  });

  it('空值與解不出來的字串回 null', () => {
    for (const v of [undefined, null, '', '不是日期']) expect(parseExifDate(v)).toBeNull();
  });
});

describe('格式化', () => {
  it('exiftool 格式：月日 / 年 / 年月日', () => {
    expect(exifMonthDay(EXIFTOOL)).toBe('04/27');
    expect(exifYear(EXIFTOOL)).toBe('2023');
    expect(exifYmd(EXIFTOOL)).toBe('2023/04/27');
  });

  it('ISO 格式不會被切壞（原本 split(":") 會切出 "45/09.000Z"）', () => {
    expect(exifMonthDay(ISO)).toMatch(/^\d{2}\/\d{2}$/);
    expect(exifYear(ISO)).toMatch(/^\d{4}$/);
    expect(exifYmd(ISO)).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it('解不出來一律空字串（呼叫端靠這個退回 title）', () => {
    for (const f of [exifMonthDay, exifYear, exifYmd]) expect(f(null)).toBe('');
  });
});
