// 部落格資料層的 queryOptions。
//
// 為什麼是這一支：分支覆蓋 20%，而這個檔案裡幾乎每一段註解都記著一次**已經發生過的**
// 事故——漏帶 lang 導致 /en/blog 抓成 zh-TW、少了 keepPreviousData 導致整頁閃、
// 計數不帶 lang 導致「側欄寫 4 篇、點進去 0 篇」。那些註解是唯一的守衛，
// 而註解擋不住任何人。
//
// 最重要的是 MDX 那段：**編譯失敗是靜默退回 markdown**（CLAUDE.md 也特別標了這件事）。
// 讀者看到的是一行裸的 `<Poll ... />`，而 API 照樣回 200、CI 照樣綠。
// 這是整個前端最安靜的失敗之一。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepPreviousData } from '@tanstack/react-query';

// apiUrl 在 SSR 會加上 base，這裡不是要測它 —— 原樣回傳，斷言才看得懂
vi.mock('@/lib/api', () => ({ apiUrl: (p: string) => p }));

const compileMdx = vi.fn<(arg: { data: string }) => Promise<string>>();
vi.mock('@/lib/mdx/mdx-compile', () => ({ compileMdx: (arg: { data: string }) => compileMdx(arg) }));

const {
  blogCategoriesDetailQueryOptions,
  blogCategoriesQueryOptions,
  blogTagsQueryOptions,
  postDetailQueryOptions,
  postReactionsQueryOptions,
  postsListQueryOptions,
  recentPostsQueryOptions,
  seriesQueryOptions,
} = await import('./blogList');

/** 記錄被打的網址，並回一個可控的回應 */
let lastUrl = '';
const mockFetch = (body: unknown, init: { status?: number; ok?: boolean } = {}) => {
  const status = init.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      lastUrl = url;
      return Promise.resolve({
        ok: init.ok ?? (status >= 200 && status < 300),
        status,
        json: () => Promise.resolve(body),
      });
    }),
  );
};

/** queryFn 的型別在 options 裡帶了一堆 context，測試只需要呼叫它 */
const run = async (opts: { queryFn?: unknown }): Promise<unknown> => (opts.queryFn as () => Promise<unknown>)();

beforeEach(() => {
  lastUrl = '';
  compileMdx.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('postDetailQueryOptions：MDX 編譯失敗是靜默退回', () => {
  const post = (over: Record<string, unknown> = {}) => ({
    message: 'success',
    id: 42,
    format: 'mdx',
    content: '# hi',
    ...over,
  });

  it('編譯成功 → 帶著 compiledMdx 回去', async () => {
    mockFetch(post());
    compileMdx.mockResolvedValue('COMPILED');
    const out = (await run(postDetailQueryOptions(42, 'en'))) as { compiledMdx?: string };
    expect(out.compiledMdx).toBe('COMPILED');
  });

  // ⚠ 這條是整支最重要的。編譯失敗**不會 404、不會 throw**，只是回沒有 compiledMdx 的
  // 原始資料 → 前台退回 markdown 渲染 → 讀者看到裸的 `<Poll ... />`，而 API 回 200。
  // 沒有任何東西會告訴你這件事發生了，只有這行 console.error。
  it('編譯失敗 → 不 throw、不帶 compiledMdx，而且要留下 console.error', async () => {
    mockFetch(post());
    compileMdx.mockRejectedValue(new Error('裸的 <Tag>'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const out = (await run(postDetailQueryOptions(42, 'en'))) as { compiledMdx?: string; id: number };

    expect(out.compiledMdx).toBeUndefined(); // ← 前台據此退回 markdown
    expect(out.id).toBe(42); // 文章本身照樣顯示，不是整篇消失
    expect(spy).toHaveBeenCalled(); // ← 唯一的痕跡，拿掉就真的無聲無息
  });

  it('非 mdx 的文章根本不呼叫編譯器', async () => {
    mockFetch(post({ format: 'markdown' }));
    await run(postDetailQueryOptions(42, ''));
    expect(compileMdx).not.toHaveBeenCalled();
  });
});

describe('postDetailQueryOptions：錯誤要分得出是哪一種', () => {
  // 404 與其他錯誤走的是**不同的 UI**：前者顯示「這個語系沒有這篇」，
  // 後者才是 notFound。訊息寫錯的話語系缺失會被當成文章不存在。
  it('404 丟 LOCALE_NOT_AVAILABLE，其他狀態丟 Post not found', async () => {
    mockFetch({}, { status: 404 });
    await expect(run(postDetailQueryOptions(1, 'ko'))).rejects.toThrow('LOCALE_NOT_AVAILABLE');

    mockFetch({}, { status: 500 });
    await expect(run(postDetailQueryOptions(1, 'ko'))).rejects.toThrow('Post not found');
  });

  // 後端有可能回 200 但 body 是失敗的
  it('HTTP 200 但 message 不是 success 也要當成失敗', async () => {
    mockFetch({ message: 'error', id: 1 });
    await expect(run(postDetailQueryOptions(1, ''))).rejects.toThrow('Post not found');
  });
});

describe('網址組裝', () => {
  it('lang 為空字串時不帶 ?lang=（那是「取原文」的意思）', async () => {
    mockFetch({ message: 'success', format: 'markdown' });
    await run(postDetailQueryOptions(7, ''));
    expect(lastUrl).toBe('/api/posts/7');
  });

  it('lang 有值時帶上去，而且經過 encode', async () => {
    mockFetch({ message: 'success', format: 'markdown' });
    await run(postDetailQueryOptions(7, 'zh-CN'));
    expect(lastUrl).toBe('/api/posts/7?lang=zh-CN');
  });

  // ⚠ 註解記著的事故：舊的 client refetch 漏了 lang，/en/blog 切排序會抓成 zh-TW
  it('列表頁的網址同時帶 sortBy 與 lang', async () => {
    mockFetch({ posts: [] });
    await run(postsListQueryOptions('en', 'popular'));
    expect(lastUrl).toContain('sortBy=popular');
    expect(lastUrl).toContain('lang=en');
  });

  // ⚠ 註解記著的事故：計數不帶 lang → 「側欄寫 4 篇、點進去 0 篇」
  it('標籤／分類的計數要帶 lang，locale 為空時才不帶', async () => {
    mockFetch({ tags: [] });
    await run(blogTagsQueryOptions('ja'));
    expect(lastUrl).toBe('/api/tags?lang=ja');

    mockFetch({ categories: [] });
    await run(blogCategoriesQueryOptions('ja'));
    expect(lastUrl).toBe('/api/categories?lang=ja');

    mockFetch({ tags: [] });
    await run(blogTagsQueryOptions(''));
    expect(lastUrl).toBe('/api/tags');
  });

  it('系列名稱要 encode（名稱含斜線或空白時會拼出錯的路徑）', async () => {
    mockFetch({ posts: [] });
    await run(seriesQueryOptions('Rust 入門/上'));
    expect(lastUrl).toBe(`/api/series/${encodeURIComponent('Rust 入門/上')}`);
  });
});

describe('queryKey：漏掉一個維度就會拿到別的語系的快取', () => {
  // id 傳數字或字串必須產生**同一把 key**：route loader 用 prefetch、元件用 useQuery，
  // 兩邊的型別來源不同（params 是字串），key 不一致就會各抓一次——
  // 而這個檔案的檔頭寫著「消掉雙抓」正是它存在的理由。
  it('文章詳情的 id 正規化成字串，數字與字串同一把 key', () => {
    expect(postDetailQueryOptions(42, 'en').queryKey).toEqual(postDetailQueryOptions('42', 'en').queryKey);
    expect(postDetailQueryOptions(42, 'en').queryKey).toEqual(['post', 'detail', '42', 'en']);
  });

  it('文章詳情的 key 帶 lang，不同語系不會互相污染', () => {
    expect(postDetailQueryOptions(1, 'en').queryKey).not.toEqual(postDetailQueryOptions(1, 'ja').queryKey);
  });

  it('列表的 key 同時帶 locale 與 sortBy', () => {
    expect(postsListQueryOptions('en', 'latest').queryKey).toEqual(['posts', 'list', 'en', 'latest']);
    expect(postsListQueryOptions('en', 'latest').queryKey).not.toEqual(postsListQueryOptions('ja', 'latest').queryKey);
    expect(postsListQueryOptions('en', 'latest').queryKey).not.toEqual(postsListQueryOptions('en', 'popular').queryKey);
  });

  it('標籤／分類的 key 帶 locale', () => {
    expect(blogTagsQueryOptions('en').queryKey).not.toEqual(blogTagsQueryOptions('ja').queryKey);
    expect(blogCategoriesQueryOptions('en').queryKey).not.toEqual(blogCategoriesQueryOptions('ja').queryKey);
    expect(blogCategoriesDetailQueryOptions('en').queryKey).not.toEqual(
      blogCategoriesDetailQueryOptions('ja').queryKey,
    );
  });

  // 這兩個打同一個端點但用途不同（側欄計數 vs 文章頁 tooltip），key 必須分得開，
  // 否則其中一邊的 select/轉換會污染另一邊
  it('分類的「清單」與「詳情」是兩把不同的 key', () => {
    expect(blogCategoriesQueryOptions('en').queryKey).not.toEqual(blogCategoriesDetailQueryOptions('en').queryKey);
  });

  it('最新文章的 key 帶 limit 與 locale，locale 未給時用空字串佔位', () => {
    expect(recentPostsQueryOptions(5).queryKey).toEqual(['posts', 'recent', 5, '']);
    expect(recentPostsQueryOptions(5, 'ja').queryKey).toEqual(['posts', 'recent', 5, 'ja']);
    expect(recentPostsQueryOptions(5).queryKey).not.toEqual(recentPostsQueryOptions(10).queryKey);
  });

  it('反應的 postId 也正規化成字串', () => {
    expect(postReactionsQueryOptions(3).queryKey).toEqual(postReactionsQueryOptions('3').queryKey);
  });
});

describe('切排序不該整頁閃', () => {
  // ⚠ 這條擋的是一個很難自己發現的回歸：sortBy 進了 queryKey，換排序就是全新的 query
  // → 沒快取 → isPending=true → Blog.tsx 的 `if (loading)` 把整頁換成全螢幕載入畫面。
  // 而且**只有第一次按會閃**（之後那把 key 有 5 分鐘快取），所以很容易被當成錯覺。
  it('列表 query 帶著 keepPreviousData', () => {
    expect(postsListQueryOptions('zh-TW', 'latest').placeholderData).toBe(keepPreviousData);
  });

  // 只有列表需要：其他 query 換的不是「同一份資料的不同排法」，
  // 留著舊資料反而會顯示錯的東西
  it('其他 query 沒有 keepPreviousData', () => {
    expect(postDetailQueryOptions(1, 'en').placeholderData).toBeUndefined();
    expect(blogTagsQueryOptions('en').placeholderData).toBeUndefined();
  });
});

describe('回應的解包', () => {
  it('各自取出對應的欄位而不是整包回傳', async () => {
    mockFetch({ posts: [{ id: 1 }] });
    expect(await run(postsListQueryOptions('en', 'latest'))).toEqual([{ id: 1 }]);

    mockFetch({ reactions: [{ emoji: '👍' }] });
    expect(await run(postReactionsQueryOptions(1))).toEqual([{ emoji: '👍' }]);

    mockFetch({ tags: [{ name: 'rust' }] });
    expect(await run(blogTagsQueryOptions('en'))).toEqual([{ name: 'rust' }]);

    mockFetch({ categories: [{ name: '技術' }] });
    expect(await run(blogCategoriesQueryOptions('en'))).toEqual([{ name: '技術' }]);

    mockFetch({ posts: [{ id: 2 }] });
    expect(await run(seriesQueryOptions('s'))).toEqual([{ id: 2 }]);
  });

  it('HTTP 不 ok 一律 throw，不會把錯誤當成空清單吞掉', async () => {
    for (const opts of [
      postsListQueryOptions('en', 'latest'),
      postReactionsQueryOptions(1),
      seriesQueryOptions('s'),
      blogTagsQueryOptions('en'),
      blogCategoriesQueryOptions('en'),
      recentPostsQueryOptions(5),
    ]) {
      mockFetch({}, { status: 500 });
      await expect(run(opts)).rejects.toThrow();
    }
  });
});
