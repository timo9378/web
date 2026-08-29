import { describe, expect, it } from 'vitest';
import { pickActiveHeading, readingProgressPct, splitTitle } from './blogReading';

// 這三個原本埋在 BlogPost.tsx（2337 行、92 個 hook）裡，e2e 只走到 16%。
// 它們的共通點是**壞掉不會報錯**：標題少了副標、進度條消失、TOC 高亮不動——
// 三種都只是「看起來怪怪的」，沒有任何東西會告訴你。

describe('splitTitle', () => {
  it('全形冒號直接拆，後面不需要空白', () => {
    expect(splitTitle('為什麼我開始使用 Zed 編輯器：從 VS Code 搬家')).toEqual({
      main: '為什麼我開始使用 Zed 編輯器',
      sub: '從 VS Code 搬家',
    });
  });

  it('半形冒號後面要有空白才算分隔符', () => {
    expect(splitTitle('CrowdSec: 取代 fail2ban')).toEqual({ main: 'CrowdSec', sub: '取代 fail2ban' });
  });

  // 半形要求空白就是為了這幾種——它們的冒號兩側沒有空白，切下去會得到莫名其妙的副標
  it('冒號兩側沒空白的一律不拆', () => {
    expect(splitTitle('Rust 1.85:2024 edition')).toEqual({ main: 'Rust 1.85:2024 edition', sub: null });
    expect(splitTitle('會議在 09:30 開始')).toEqual({ main: '會議在 09:30 開始', sub: null });
    expect(splitTitle('16:9 的螢幕')).toEqual({ main: '16:9 的螢幕', sub: null });
  });

  it('沒有分隔符就是單一主標', () => {
    expect(splitTitle('一個普通標題')).toEqual({ main: '一個普通標題', sub: null });
    expect(splitTitle('')).toEqual({ main: '', sub: null });
  });

  it('分隔符在開頭不拆（不然主標會是空的）', () => {
    expect(splitTitle('：只有副標')).toEqual({ main: '：只有副標', sub: null });
  });

  it('分隔符在結尾不拆（不然副標會是空的）', () => {
    expect(splitTitle('只有主標：')).toEqual({ main: '只有主標：', sub: null });
    expect(splitTitle('只有主標: ')).toEqual({ main: '只有主標: ', sub: null });
  });

  it('取第一個分隔符，副標裡還有冒號也不會再拆一次', () => {
    expect(splitTitle('主標：副標：還有更多')).toEqual({ main: '主標', sub: '副標：還有更多' });
  });

  it('兩邊的空白會修掉', () => {
    expect(splitTitle('主標 ： 副標')).toEqual({ main: '主標', sub: '副標' });
  });
});

describe('readingProgressPct', () => {
  it('捲到底是 100、還沒捲是 0', () => {
    expect(readingProgressPct(0, 800, 2000)).toBe(0);
    expect(readingProgressPct(1200, 800, 2000)).toBe(100);
    expect(readingProgressPct(600, 800, 2000)).toBe(50);
  });

  // 這條是重點：頁面短到捲不動時，除法會得到 Infinity 或 NaN，
  // 而進度條吃到 NaN 會整條消失（不是變成 0%），看起來像功能壞了。
  it('頁面捲不動時回 0，不會是 NaN 或 Infinity', () => {
    expect(readingProgressPct(0, 800, 800)).toBe(0);
    expect(readingProgressPct(0, 800, 400)).toBe(0);
    expect(Number.isNaN(readingProgressPct(0, 800, 800))).toBe(false);
  });

  it('捲過頭（橡皮筋回彈）也夾在 0~100', () => {
    expect(readingProgressPct(-200, 800, 2000)).toBe(0);
    expect(readingProgressPct(99999, 800, 2000)).toBe(100);
  });
});

describe('pickActiveHeading', () => {
  const WH = 800;

  it('閱讀帶內取離 100px 最近的那個', () => {
    expect(
      pickActiveHeading(
        [
          { id: 'a', top: 190 },
          { id: 'b', top: 110 },
          { id: 'c', top: -80 },
        ],
        WH,
      ),
    ).toBe('b');
  });

  it('剛好落在邊界（-100 與 200）也算在帶內', () => {
    expect(pickActiveHeading([{ id: 'top', top: -100 }], WH)).toBe('top');
    expect(pickActiveHeading([{ id: 'bottom', top: 200 }], WH)).toBe('bottom');
  });

  it('超出邊界一點點就掉出閱讀帶', () => {
    // 捲過頭（top < -100）兩段都接不住 → 空
    expect(pickActiveHeading([{ id: 'x', top: -101 }], WH)).toBe('');
    // 但往下超出（top > 200）**會被後備接住**——它還在視窗內。
    // 用一個帶內的對照組才看得出「它確實不在帶內」：帶內那個會贏。
    expect(pickActiveHeading([{ id: 'x', top: 201 }], WH)).toBe('x');
    expect(
      pickActiveHeading(
        [
          { id: 'x', top: 201 },
          { id: 'inBand', top: 199 },
        ],
        WH,
      ),
    ).toBe('inBand');
  });

  // 停在兩個標題之間的長段落時最容易發生：帶內一個都沒有。
  // 留空的話 TOC 高亮會整個消失，讀者會以為目錄壞了。
  it('帶內沒有時退而取第一個還在視窗內的', () => {
    expect(
      pickActiveHeading(
        [
          { id: 'a', top: -500 },
          { id: 'b', top: 400 },
          { id: 'c', top: 700 },
        ],
        WH,
      ),
    ).toBe('b');
  });

  it('後備只看視窗內，捲出畫面下方的不算', () => {
    expect(
      pickActiveHeading(
        [
          { id: 'a', top: -500 },
          { id: 'b', top: 900 },
        ],
        WH,
      ),
    ).toBe('');
  });

  it('帶內優先於後備，順序不能對調', () => {
    // 'later' 在帶內但排在後面，'early' 只符合後備條件卻排在前面
    expect(
      pickActiveHeading(
        [
          { id: 'early', top: 500 },
          { id: 'later', top: 120 },
        ],
        WH,
      ),
    ).toBe('later');
  });

  // 以下三條是變異測試（Stryker）指出來的漏洞：邊界只測了「有沒有算進帶內」，
  // 沒測「邊界值本身換成嚴格不等號會不會被抓到」。改成讓後備會挑到**別人**，
  // 邊界那個才真的被驗到。
  it('top 剛好 200 算在帶內，會贏過只符合後備條件的', () => {
    // 若 `<= 200` 被改成 `< 200`，'edge' 掉出帶內 → 後備會挑到排在前面的 'other'
    expect(
      pickActiveHeading(
        [
          { id: 'other', top: 500 },
          { id: 'edge', top: 200 },
        ],
        WH,
      ),
    ).toBe('edge');
  });

  it('後備的下界是「大於 0」：剛好 0 不算', () => {
    expect(pickActiveHeading([{ id: 'zero', top: 0 }], 800)).toBe('zero'); // 0 在帶內（-100~200）
    // 帶外、剛好 0 → 後備也不該收（`> 0` 若被改成 `>= 0` 這條會紅）
    expect(
      pickActiveHeading(
        [
          { id: 'far', top: -300 },
          { id: 'zero', top: 0 },
        ],
        800,
      ),
    ).toBe('zero');
    expect(pickActiveHeading([{ id: 'onlyZeroOutOfBand', top: -100 }], 800)).toBe('onlyZeroOutOfBand');
  });

  it('後備的上界是「小於視窗高」：剛好等於視窗高不算', () => {
    expect(pickActiveHeading([{ id: 'atEdge', top: 800 }], 800)).toBe('');
  });

  it('一個標題都沒有就回空字串（呼叫端自己決定要不要沿用上一個）', () => {
    expect(pickActiveHeading([], WH)).toBe('');
  });

  it('多個同樣接近時取更接近的，平手時取先出現的', () => {
    // 兩個都距離 100 有 50px，先出現的贏（`<` 而不是 `<=`）
    expect(
      pickActiveHeading(
        [
          { id: 'first', top: 50 },
          { id: 'second', top: 150 },
        ],
        WH,
      ),
    ).toBe('first');
  });
});
