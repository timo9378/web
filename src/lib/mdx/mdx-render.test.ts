/**
 * MDX 渲染管線的兩件事：**界線守得住**，以及**輸出沒有回歸**。
 *
 * 背景：前端原本用 `runSync`（底層 `new Function`）執行 server 編譯出的 JS 字串，
 * 那需要 CSP 的 `'unsafe-eval'`。改成 server 產序列化的 hast 樹、前端用
 * `hast-util-to-jsx-runtime` 走訪——沒有任何字串轉程式碼。
 *
 * 代價是 MDX 只能「叫元件、餵資料」。這個檔就是釘住那條界線：哪些寫法會被擋、
 * 哪些照常運作。界線鬆掉不會有症狀（東西照樣顯示），只有 CSP 那條會默默失效。
 *
 * ⚠ 這裡不比對「新舊兩條路徑的輸出」——那個對拍在遷移時做過（15 篇 × 5 語系
 *   逐字相同），但舊路徑已經刪掉了，留著比對就得把 `runSync` 留在相依裡，
 *   等於為了測試留著要移除的東西。改成釘住**具體的輸出結構**。
 */
import { describe, expect, it } from 'vitest';
import { compileMdxToHastJson, MdxUnsupportedError } from '@koimsurai/mdx-core';

const compile = (src: string) => compileMdxToHastJson(src);

describe('MDX 可渲染性的界線', () => {
  it('元件 + 純資料屬性：通過，而且屬性值原樣保留', async () => {
    const json = await compile('<Poll id="demo" open options={[{key:"a",label:"甲"},{key:"b",label:"乙"}]} n={3} />\n');
    // 屬性要真的留在樹裡——只驗「編得過」的話，屬性掉光了也會綠
    expect(json).toContain('"demo"');
    expect(json).toContain('label');
    expect(json).toContain('乙');
  });

  it.each([
    ['內文運算式', '今年是 {new Date().getFullYear()} 年\n'],
    ['屬性裡的運算', '<Note title={1 + 1}>x</Note>\n'],
    ['樣板字串屬性', '<Note title={`第 ${1} 章`}>x</Note>\n'],
    ['import', 'import X from "y"\n\n<Note>x</Note>\n'],
    ['export', 'export const a = 1\n\n<Note>x</Note>\n'],
    ['展開屬性', '<Note {...p}>x</Note>\n'],
  ])('%s 會被擋下', async (_name, src) => {
    await expect(compile(src)).rejects.toBeInstanceOf(MdxUnsupportedError);
  });

  it('擋下來的訊息要說得出「怎麼改」，不能只說錯了', async () => {
    const err = await compile('{1 + 1}\n').then(
      () => new Error('應該要丟錯才對'),
      (e: unknown) => e as MdxUnsupportedError,
    );
    // 這些訊息會直接被 agent 與 CI 看到；只講「不支援」等於要人自己猜
    expect(err.message).toMatch(/運算式/);
    expect(err.message).toMatch(/做成元件|直接寫出來/);
  });

  it('未註冊的元件在有清單時就被擋下', async () => {
    await expect(compileMdxToHastJson('<Nope />\n', new Set(['Note']))).rejects.toThrow(/沒有註冊/);
    await expect(compileMdxToHastJson('<Note>x</Note>\n', new Set(['Note']))).resolves.toBeTypeOf('string');
  });
});

describe('序列化的樹', () => {
  it('不帶位置資訊——留著會讓 payload 變 3.8 倍', async () => {
    const json = await compile('# 標題\n\n<Note>內文</Note>\n');
    expect(json).not.toContain('"position"');
    expect(json).not.toContain('"line"');
  });

  it('但保留 data.estree——屬性值是靠它傳到前端的', async () => {
    // 這條是被實際的 bug 逼出來的：第一版把 estree 一起抽掉，編譯正常、樹裡也有
    // <Poll>，但前端渲染出來屬性全不見（hast-util-to-jsx-runtime 就是讀它）。
    const json = await compile('<Poll options={[{key:"a"}]} />\n');
    expect(json).toContain('estree');
  });

  it('markdown 的部分照常編（GFM 表格與 alert 都在管線裡）', async () => {
    const json = await compile('| a | b |\n| - | - |\n| 1 | 2 |\n\n> [!WARNING]\n> 小心\n');
    expect(json).toContain('table');
    expect(json).toContain('markdown-alert');
  });
});
