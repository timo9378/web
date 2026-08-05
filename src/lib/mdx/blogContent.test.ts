import { describe, expect, it } from 'vitest';
import { computeReadTime, extractHeadings, slugify } from './blogContent';

// 這三個函式決定文章頁的 anchor id、右側 TOC 與閱讀時間。
// BlogPost（完整版）與 BlogPostPage（SSR fallback）共用同一份，
// 所以這裡的行為變了，兩邊會一起變——不會出現「目錄對不到標題」的半套狀態。

describe('slugify', () => {
  it('英文：小寫化、空白變連字號', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Trim   Me  ')).toBe('trim-me');
  });

  it('連續的連字號收成一個', () => {
    expect(slugify('a  --  b')).toBe('a-b');
  });

  it('漢字保留，標點與符號去掉', () => {
    expect(slugify('為什麼要用 Rust')).toBe('為什麼要用-rust');
    expect(slugify('全形，標點。測試')).toBe('全形標點測試');
    expect(slugify('C++ 與 C#')).toBe('c-與-c');
  });

  // 以下三條是這個函式原本壞掉的地方：字元類別只寫了 CJK 統一漢字（一-龥），
  // 於是日文的假名被吃掉、韓文整個塌成一個 `-`。線上 ko 版真的長那樣
  // （/ko/blog/why-i-switched-to-zed 的 25 個標題有 14 個 id 是 `-`，TOC 全指同一處）。
  it('日文：假名要留著，不能只留漢字', () => {
    expect(slugify('まず請求書を見る')).toBe('まず請求書を見る');
    expect(slugify('ぜんぶ日本語')).toBe('ぜんぶ日本語');
    expect(slugify('パルワールドの話')).toBe('パルワールドの話');
    expect(slugify('人々の時々')).toBe('人々の時々'); // 疊字符 々
  });

  it('韓文：諺文要留著，否則同一篇的標題 id 會全部撞在一起', () => {
    expect(slugify('한국어 제목')).toBe('한국어-제목');
    expect(slugify('먼저 청구서를 본다')).toBe('먼저-청구서를-본다');
    // 真正的症狀是「撞號」，所以直接驗互不相同
    const ids = ['먼저 청구서를 본다', '공식 이사 경로가 있다', '무엇을 가져오고'].map(slugify);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emoji 這類非文字符號還是要去掉（它們進網址只會變一長串 %F0）', () => {
    expect(slugify('emoji 🚀 標題')).toBe('emoji-標題');
  });
});

describe('extractHeadings', () => {
  it('抽 h1~h4，h5 以下不收（TOC 再深就沒有可讀性了）', () => {
    expect(extractHeadings('# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六').map((h) => h.level)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('id 與 slugify 同一份邏輯，TOC 才連得到標題元素', () => {
    expect(extractHeadings('## 為什麼要用 Rust')).toEqual([
      { id: '為什麼要用-rust', text: '為什麼要用 Rust', level: 2 },
    ]);
  });

  it('井號後面沒空白不算標題（那是 hashtag 或註解）', () => {
    expect(extractHeadings('#沒空白\n# 有空白').map((h) => h.text)).toEqual(['有空白']);
  });

  it('code block 裡的井號不算標題', () => {
    expect(extractHeadings('# 真的\n```bash\n# 這是註解\n```\n## 也是真的').map((h) => h.text)).toEqual([
      '真的',
      '也是真的',
    ]);
  });

  // 舊寫法是 `content.replace(/```[\s\S]*?```/g, '')`，這兩種情況它擋不住。
  it('沒閉合的 code block 也要擋住（寫到一半的草稿很常這樣）', () => {
    expect(extractHeadings('# 真的\n```js\n// 下面這行是註解不是標題\n# 假的\n').map((h) => h.text)).toEqual([
      '真的',
    ]);
  });

  it('`~~~` 也是合法的 fence', () => {
    expect(extractHeadings('# 真的\n~~~js\n# 假的\n~~~\n## 也是真的').map((h) => h.text)).toEqual([
      '真的',
      '也是真的',
    ]);
  });

  it('不同標記不會互相收掉：``` 開的只有 ``` 關得掉', () => {
    expect(extractHeadings('```\n# 假的\n~~~\n# 還是假的\n```\n# 真的').map((h) => h.text)).toEqual(['真的']);
  });

  // 站上真的有幾篇是 CRLF 存進資料庫的。JS 的 `.` 不吃行終止符，
  // 沒處理好的話這幾篇的目錄會**整個空掉**——而且畫面上只是「右邊沒有目錄」，不會報錯。
  it('CRLF 的內容照樣抽得到標題，且結果與 LF 版一模一樣', () => {
    const lf = '# 一\n內文\n## 二\n內文\n### 三';
    expect(extractHeadings(lf.replace(/\n/g, '\r\n'))).toEqual(extractHeadings(lf));
    expect(extractHeadings(lf)).toHaveLength(3);
  });

  it('CRLF 下的 code block 一樣擋得住', () => {
    const src = '# 真的\r\n```bash\r\n# 註解\r\n```\r\n## 也是真的';
    expect(extractHeadings(src).map((h) => h.text)).toEqual(['真的', '也是真的']);
  });

  it('標題文字不會夾帶行尾的 \\r', () => {
    const [h] = extractHeadings('## 為什麼要用 Rust\r\n');
    expect(h.text).toBe('為什麼要用 Rust');
    expect(h.id).toBe('為什麼要用-rust');
  });

  it('沒有標題就回空陣列，不是 null', () => {
    expect(extractHeadings('只有一段內文。')).toEqual([]);
    expect(extractHeadings('')).toEqual([]);
  });
});

describe('computeReadTime', () => {
  it('至少回 1 分鐘（空內容也不會是 0 分鐘）', () => {
    expect(computeReadTime('')).toBe(1);
    expect(computeReadTime('短短一句')).toBe(1);
  });

  it('約 500 字一分鐘，無條件進位', () => {
    expect(computeReadTime('字'.repeat(500))).toBe(1);
    expect(computeReadTime('字'.repeat(501))).toBe(2);
    expect(computeReadTime('字'.repeat(1500))).toBe(3);
  });

  it('HTML 標籤與 markdown 符號不算進字數', () => {
    const plain = '字'.repeat(600);
    expect(computeReadTime(`<div class="x">${plain}</div>`)).toBe(computeReadTime(plain));
    expect(computeReadTime(`## ${plain}`)).toBe(computeReadTime(plain));
  });
});
