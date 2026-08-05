import { describe, expect, it } from 'vitest';
import { thoughtTitle } from './thoughtData';

// 碎念沒有標題欄位，這個函式的輸出會同時當成頁面 title、分享文字與列表項目標題。
// 壞掉的話是「畫面上多一個 �」這種沒有人會回報、但每個人都看得到的問題。

describe('thoughtTitle', () => {
  it('短內容原樣回傳，不加省略號', () => {
    expect(thoughtTitle('今天很熱')).toBe('今天很熱');
  });

  it('換行與連續空白收成單一空白', () => {
    expect(thoughtTitle('第一行\n第二行')).toBe('第一行 第二行');
    expect(thoughtTitle('  前後有空白   中間也是  ')).toBe('前後有空白 中間也是');
  });

  it('剛好 32 個字不截斷，第 33 個才截', () => {
    expect(thoughtTitle('あ'.repeat(32))).toBe('あ'.repeat(32));
    expect(thoughtTitle('あ'.repeat(33))).toBe(`${'あ'.repeat(32)}…`);
  });

  // 這條是實際修掉的 bug：原本用 slice() 依 UTF-16 code unit 切，
  // emoji 佔兩個 code unit，切在代理對中間就留下半個字元。
  it('emoji 不會被從中間切開', () => {
    // 前面墊一個 ASCII 讓截斷點落在**奇數**的 code unit 偏移——
    // 也就是舊實作 slice(0, 32) 剛好切在代理對正中間的那個位置。
    const out = thoughtTitle(`a${'🚀'.repeat(40)}`);
    expect(out.endsWith('…')).toBe(true);
    // 沒有落單的 high surrogate（U+D800–U+DBFF 後面沒有接 low surrogate）
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    // 截斷長度用碼點算：32 個碼點 + 省略號
    expect(Array.from(out)).toHaveLength(33);
  });

  it('全部都是 emoji 也一樣', () => {
    const out = thoughtTitle('🎉'.repeat(50));
    expect(Array.from(out)).toEqual([...Array.from({ length: 32 }, () => '🎉'), '…']);
  });

  it('空內容回空字串，不會變成一個孤零零的省略號', () => {
    expect(thoughtTitle('')).toBe('');
    expect(thoughtTitle('   \n  ')).toBe('');
  });
});
