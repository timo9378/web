// @vitest-environment jsdom
//
// 全元件的掛載煙霧測試：把每個元件用預設 props 掛起來，斷言它不會炸。
//
// 這支存在的理由是**數量**：`src/components` 佔前端覆蓋率分母的 79%（5477/6923 行），
// 一支一支手寫測試追不上。這裡用一支參數化測試涵蓋全部，成本是一個檔。
//
// ⚠ 它抓得到什麼、抓不到什麼，講清楚免得誤會它的價值：
//   ✅ import 期就炸（循環相依、頂層取 window / document）
//   ✅ 掛載期就炸（缺 provider、預設 props 沒防呆、effect 裡取用不存在的東西）
//   ❌ 任何**行為**錯誤——那要斷言輸出，不是這支的工作
//
//   對 e2e 走得到的元件，它的邊際價值不高（e2e 本來就在渲染它們）。
//   真正的收穫在 **e2e 碰不到的那批**：後台子面板、錯誤狀態、
//   以及量覆蓋率時發現「從頭到尾沒被載入過」的那些檔案。

import type React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

/**
 * 需要必填 props 才掛得起來的元件。
 *
 * ⚠ 這份清單是**刻意手寫**的，而且刻意讓「新增元件時測試會紅」——紅了就是在問
 * 「這個元件沒有 props 掛不起來，是設計如此還是防呆漏了？」，那個判斷值得被逼著做一次。
 * props 給最小可渲染的一組就好，這支測的是「掛得起來」，不是行為。
 */
const PROPS: Record<string, Record<string, unknown>> = {
  'blog/ThoughtCard.tsx': {
    th: { id: 1, content: '測試碎念', created_at: '2026-01-01 00:00:00', likes: 0, dislikes: 0 },
  },
  'gallery/GalleryThumbnail.tsx': {
    photos: [],
    activeIndex: 0,
    onThumbnailClick: vi.fn(),
    thumbsSwiper: null,
    onSwiper: vi.fn(),
  },
  'media/FavoritesEditor.tsx': { favorites: [], onClose: vi.fn(), onChanged: vi.fn() },
};

/**
 * 掛載時允許出現的 console.error —— **每一條都要寫清楚為什麼**。
 *
 * ⚠ 這裡只放「測試環境造成的」，不放「元件本來就會噴的」。後者該去修元件。
 */
const ALLOWED_ERRORS: { re: RegExp; why: string }[] = [
  {
    re: /Failed to parse URL from \//,
    why: 'jsdom 的 fetch 不吃相對網址（瀏覽器吃）。元件用 `/api/...` 是對的，是環境的限制。',
  },
  {
    re: /getSupportedExtensions|WebGL|getContext/i,
    why: 'jsdom 沒有 WebGL。元件自己有降級路徑（html.no-gpu），那條由 e2e 驗。',
  },
];

/**
 * ⚠ glob 的字串必須是**字面值**，vite 靠靜態分析它才展得開——
 * 不能抽成變數，也不能用樣板字串拼。
 */
const MODULES = import.meta.glob('/src/components/**/*.tsx', { eager: false });

/** shadcn 與 animate-ui 產生的檔（CLAUDE.md：這兩個路徑不手動整理），還有測試自己。 */
const EXCLUDE = /\/(ui|animate-ui)\/|\.test\.tsx$/;

const entries = Object.entries(MODULES)
  .filter(([path]) => !EXCLUDE.test(path))
  .sort(([a], [b]) => a.localeCompare(b));

afterEach(cleanup);

describe('全元件掛載煙霧測試', () => {
  it('找得到元件檔（glob 沒展開的話這支等於沒跑）', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  for (const [path, load] of entries) {
    const name = path.replace('/src/components/', '');
    it(`${name} 掛得起來`, async () => {
      // ⚠ 一定要攔 console.error。元件在掛載時丟出的錯會被 RouterProvider 的
      //   預設 error boundary 接住 —— render 不會 throw，測試會**假綠**。
      //   React 在接住時一定會印 "The above error occurred in <X>"，攔它才抓得到。
      //   （這支測試第一版就是這樣：三個元件其實掛載即炸，而它回報全過。）
      const seen: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => {
        seen.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
      };
      try {
        const mod = (await load()) as { default?: unknown };
        const Comp = mod.default as React.ComponentType<Record<string, unknown>> | undefined;
        // 沒有 default export 的（純型別檔、具名匯出集合）只驗 import 不炸
        if (typeof Comp !== 'function') return;
        await renderWithProviders(<Comp {...(PROPS[name] ?? {})} />);
      } finally {
        console.error = original;
      }

      const unexpected = seen.filter((m) => !ALLOWED_ERRORS.some(({ re }) => re.test(m)));
      expect(unexpected, `${name} 掛載時噴了非預期的錯誤`).toEqual([]);
    });
  }
});
