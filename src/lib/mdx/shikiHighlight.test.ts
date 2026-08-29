// Shiki 程式碼高亮的語言解析。
//
// 為什麼是這一支：52/80 行沒被覆蓋，而它壞掉的症狀是**程式碼區塊靜靜地變成純文字**
// ——讀者看得到，但沒有人會回報「這段程式碼沒上色」，而作者自己也只會注意到常用的
// 那幾種語言。alias 表壞掉的話，寫 ```rs 的文章就從此都是白的。
//
// 這裡不碰真正的 grammar 解析（那是 shiki 的事，測它等於測別人的函式庫）。
// 只 mock 掉 core，觀察「最後拿去高亮的語言是哪一個」——alias 有沒有對到、
// 認不得的有沒有安全退回、載入失敗有沒有炸掉，都是從這個值看出來的。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** codeToHtml 收到的參數：測試真正要看的東西 */
let calls: { code: string; lang: string }[] = [];
/** loadLanguage 要不要故意失敗 */
let loadFails = false;
let loadedByHighlighter: unknown[] = [];
let createCount = 0;

vi.mock('shiki/core', () => ({
  createHighlighterCore: () => {
    createCount += 1;
    return Promise.resolve({
      codeToHtml: (code: string, opts: { lang: string }) => {
        calls.push({ code, lang: opts.lang });
        return `<pre data-lang="${opts.lang}">${code}</pre>`;
      },
      loadLanguage: (m: unknown) => {
        if (loadFails) return Promise.reject(new Error('grammar 壞了'));
        loadedByHighlighter.push(m);
        return Promise.resolve();
      },
    });
  },
}));
vi.mock('shiki/engine/oniguruma', () => ({ createOnigurumaEngine: () => ({}) }));
vi.mock('shiki/wasm', () => ({ default: {} }));

async function load() {
  vi.resetModules();
  calls = [];
  loadedByHighlighter = [];
  loadFails = false;
  createCount = 0;
  const { highlightCode } = await import('./shikiHighlight');
  return highlightCode;
}

/** 高亮一次，回傳「最後真正拿去上色的語言」 */
const langUsedFor = async (highlight: (c: string, l?: string) => Promise<string>, input?: string): Promise<string> => {
  await highlight('const a = 1', input);
  return calls.at(-1)?.lang ?? '';
};

let highlight: (c: string, l?: string) => Promise<string>;
beforeEach(async () => {
  highlight = await load();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('alias → shiki 的語言 id', () => {
  // ⚠ 這張表就是 LANG_ALIAS 的鏡像。兩邊都可能出錯：
  //   · alias 被刪掉／打錯 → 那個語言從此渲染成純文字
  //   · LANG_LOADERS 的 key 被改名 → alias 指到不存在的 loader，同樣退回純文字
  // 兩種都不會有任何錯誤訊息，只有這裡會紅。
  const EXPECTED: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    'c++': 'cpp',
    'objective-c': 'objc',
    dockerfile: 'docker',
    makefile: 'make',
    // 這四個原本不是合法的 shiki id，舊版會直接變成純文字 —— 對到最接近的 grammar
    svg: 'xml',
    mysql: 'sql',
    postgresql: 'sql',
    plsql: 'sql',
  };

  it('每個 alias 都對到真的存在的 grammar，不會靜靜退回純文字', async () => {
    for (const [alias, expected] of Object.entries(EXPECTED)) {
      expect(await langUsedFor(highlight, alias), `\`\`\`${alias} 應該用 ${expected}`).toBe(expected);
    }
  });

  it('大小寫不影響（```RS 與 ```Rs 都要認得）', async () => {
    expect(await langUsedFor(highlight, 'RS')).toBe('rust');
    expect(await langUsedFor(highlight, 'Rs')).toBe('rust');
    expect(await langUsedFor(highlight, 'TypeScript')).toBe('typescript');
  });

  it('本來就是合法 id 的不經過 alias 直接用', async () => {
    for (const id of ['rust', 'python', 'yaml', 'diff', 'vue']) {
      expect(await langUsedFor(highlight, id)).toBe(id);
    }
  });
});

describe('認不得的語言要安全退回，不是炸掉', () => {
  it('沒指定語言 → text', async () => {
    expect(await langUsedFor(highlight, undefined)).toBe('text');
    expect(await langUsedFor(highlight, '')).toBe('text');
  });

  it('不在白名單的語言 → text（而不是丟例外讓整篇文章壞掉）', async () => {
    expect(await langUsedFor(highlight, 'brainfuck')).toBe('text');
    expect(await langUsedFor(highlight, 'wolfram')).toBe('text');
  });

  // ⚠ 這條的守備範圍跟直覺不一樣，變異測試逼出來的，記在這裡免得下次誤判它沒用：
  //
  // 直接把 `lookup(LANG_LOADERS, …)` 換成 `LANG_LOADERS[…]`，這條**不會紅**——是等價變異。
  // 因為 `LANG_ALIAS[lower]` 會先命中原型鏈，把 `resolved` 變成「非字串」
  // （`constructor` → Object 函式、`__proto__` → Object.prototype），
  // 接著當成物件鍵會被轉成 `"function Object() {…}"` 之類，兩種寫法都找不到 → 都回 text。
  // 也就是說**今天** loader 那層的 `lookup()` 是雙保險，不是唯一那道鎖。
  //
  // 它真正擋得住的是「把 alias 那層改成 prototype-safe、卻留著 loader 那層直接索引」——
  // 那時 `resolved` 會是乾淨的字串 `'constructor'`，直接索引就摸到 Object.prototype.constructor、
  // 判定「這個語言存在」，然後把 `Object()` 的回傳值當 grammar 丟給 shiki。
  // 實測過那個組合會讓這條紅（1 failed / 12 passed）。
  //
  // 所以這裡釘的是**行為**（原型名 → text）而不是實作，這樣兩種寫法怎麼組合都跑不掉。
  it('原型鏈上的名字不會被當成合法語言', async () => {
    for (const evil of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(await langUsedFor(highlight, evil), `\`\`\`${evil}`).toBe('text');
    }
  });

  it('程式碼內容原樣傳下去，不會被解析語言的過程改動', async () => {
    const code = '這是一段\n有換行與 <tag> 的程式碼';
    await highlight(code, 'brainfuck');
    expect(calls.at(-1)?.code).toBe(code);
  });
});

describe('grammar 動態載入', () => {
  // ⚠ 這條原本釘的是相反的行為（「預載的三個語言不會再 loadLanguage」）。
  // 那個預載已經拿掉了：三個 grammar 加起來 520 KB，而實測正式站 18 篇含程式碼的文章
  // 裡有 10 篇（56%）根本用不到 js/ts/tsx，卻無條件付那筆流量。
  // 現在**沒有任何語言預載**，全部按需——改回去的話這條會紅。
  it('沒有任何語言是預載的，js/ts/tsx 也要按需載入', async () => {
    for (const l of ['javascript', 'typescript', 'tsx']) await highlight('x', l);
    expect(loadedByHighlighter, 'js/ts/tsx 應該跟其他語言一樣按需載入').toHaveLength(3);
  });

  it('沒預載的語言會載一次，第二次就用快取', async () => {
    await highlight('x', 'rust');
    expect(loadedByHighlighter).toHaveLength(1);
    await highlight('x', 'rust');
    expect(loadedByHighlighter, '同一個語言不該重複載').toHaveLength(1);
    await highlight('x', 'go');
    expect(loadedByHighlighter).toHaveLength(2);
  });

  // grammar 載入失敗（網路斷、chunk 404）不該讓整篇文章掛掉——退回純文字至少讀得到
  it('載入失敗退回純文字，不往外丟例外', async () => {
    loadFails = true;
    await expect(highlight('x', 'rust')).resolves.toBeTypeOf('string');
    expect(calls.at(-1)?.lang).toBe('text');
  });

  it('text 不會去載 grammar（它是 fallback，本來就沒有對應的 loader）', async () => {
    await highlight('x', 'text');
    await highlight('x', 'brainfuck');
    expect(loadedByHighlighter).toHaveLength(0);
  });
});

describe('highlighter 是單例', () => {
  // 每次建立都要重新初始化 oniguruma 的 wasm，那是這條路徑上最貴的一步。
  // 建成多份不會有錯誤訊息，只是每個程式碼區塊都慢一次。
  it('連續高亮很多次只建立一個 highlighter', async () => {
    for (const l of ['rust', 'go', 'python', 'yaml', undefined]) await highlight('x', l);
    expect(createCount).toBe(1);
  });

  it('同時發出的多次呼叫也只建立一個（併發不該各建一份）', async () => {
    await Promise.all(['rust', 'go', 'python', 'java'].map((l) => highlight('x', l)));
    expect(createCount).toBe(1);
  });
});
