import { queryOptions } from '@tanstack/react-query';
import type {
  PostDetailResponse, PostListItem, PostsListResponse,
  ReactionRow, SeriesPostRow, SeriesDetailResponse, ReactionsResponse,
} from '@koimsurai/api-types';
import { apiUrl } from './api';
import { compileMdx } from './lib/mdx-compile';
import type { Post, Tag, Category } from './components/Blog';

// format='mdx' 的文章多帶一個 server 端編譯好的 function-body（前端用 runSync 執行）。
export type PostDetail = PostDetailResponse & { compiledMdx?: string };

// 單篇文章（/api/posts/:id?lang=）。route loader 用 ensureQueryData 預取 → SSR head +
// dehydrate；BlogPost（ClientOnly）hydrate 後 useQuery 讀同一份快取，消掉「loader + 元件
// 各抓一次」的雙抓。404 = 該語系無此文（LOCALE_NOT_AVAILABLE），queryFn throw 讓 loader
// 轉 notFound()、元件顯示語系缺失。
export const postDetailQueryOptions = (id: string | number, lang: string) =>
  queryOptions({
    queryKey: ['post', 'detail', String(id), lang],
    queryFn: async (): Promise<PostDetail> => {
      // lang 空字串 = 取原文（不帶 lang 參數，對齊舊 articleCache/preview 的 no-lang 行為）。
      const url = lang ? `/api/posts/${id}?lang=${encodeURIComponent(lang)}` : `/api/posts/${id}`;
      const res = await fetch(apiUrl(url));
      if (res.status === 404) throw new Error('LOCALE_NOT_AVAILABLE');
      if (!res.ok) throw new Error('Post not found');
      const data = (await res.json()) as PostDetailResponse;
      if (data.message !== 'success') throw new Error('Post not found');
      // MDX 文章：server 端編譯（compiler 不進 client bundle），結果隨 query dehydrate 到 client。
      // 編譯失敗（Agent 寫錯語法，如 prose 裡有裸 <Tag>）→ 不 404 整篇，退回 markdown 渲染（至少可讀）。
      if (data.format === 'mdx') {
        try {
          const compiledMdx = await compileMdx({ data: data.content });
          return { ...data, compiledMdx };
        } catch (e) {
          console.error('[mdx] 編譯失敗，退回 markdown 渲染：', e);
          return data;
        }
      }
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

// 列表頁資料改由 TanStack Query 管理。loader 用 prefetchQuery 預取 → SSR baked。
// posts query 依 (locale, sortBy) 參數化：切換排序 = 換 queryKey 自動 refetch，
// 且**帶著 locale**（舊的 client refetch 漏了 lang，/en/blog 切排序會抓成 zh-TW）。
const STALE = 5 * 60 * 1000;

export const postsListQueryOptions = (locale: string, sortBy: string) =>
  queryOptions({
    queryKey: ['posts', 'list', locale, sortBy],
    queryFn: async (): Promise<Post[]> => {
      const res = await fetch(apiUrl(`/api/posts?sortBy=${sortBy}&limit=100&lang=${locale}`));
      if (!res.ok) throw new Error(`GET /api/posts ${res.status}`);
      const data = (await res.json()) as PostsListResponse;
      return data.posts;
    },
    staleTime: STALE,
  });

// 文章 emoji 反應。POST toggle 後由元件 setQueryData 更新快取（optimistic）。
export const postReactionsQueryOptions = (postId: string | number) =>
  queryOptions({
    queryKey: ['post', 'reactions', String(postId)],
    queryFn: async (): Promise<ReactionRow[]> => {
      const res = await fetch(apiUrl(`/api/posts/${postId}/reactions`));
      if (!res.ok) throw new Error(`GET /api/posts/${postId}/reactions ${res.status}`);
      const data = (await res.json()) as ReactionsResponse;
      return data.reactions ?? [];
    },
    staleTime: 60 * 1000,
  });

// 系列文導覽（某系列下所有文章，精簡欄位）。
export const seriesQueryOptions = (seriesName: string) =>
  queryOptions({
    queryKey: ['series', seriesName],
    queryFn: async (): Promise<SeriesPostRow[]> => {
      const res = await fetch(apiUrl(`/api/series/${encodeURIComponent(seriesName)}`));
      if (!res.ok) throw new Error(`GET /api/series ${res.status}`);
      const data = (await res.json()) as SeriesDetailResponse;
      return data.posts ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

// mega-menu「手記」與文章頁側欄用：最新 N 篇（menu 自己在 client 依 hover 分類過濾）。
// 帶 lang → 後端回該語系的標題（沒譯文自動 fallback 回原文）；locale 進 queryKey 才會換語系重抓。
export const recentPostsQueryOptions = (limit: number, locale?: string) =>
  queryOptions({
    queryKey: ['posts', 'recent', limit, locale ?? ''],
    queryFn: async (): Promise<PostListItem[]> => {
      const res = await fetch(apiUrl(`/api/posts?limit=${limit}${locale ? `&lang=${encodeURIComponent(locale)}` : ''}`));
      if (!res.ok) throw new Error(`GET /api/posts ${res.status}`);
      const data = (await res.json()) as PostsListResponse;
      return data.posts;
    },
    staleTime: STALE,
  });

export const blogTagsQueryOptions = queryOptions({
  queryKey: ['tags'],
  queryFn: async (): Promise<Tag[]> => {
    const res = await fetch(apiUrl('/api/tags'));
    if (!res.ok) throw new Error(`GET /api/tags ${res.status}`);
    const data = (await res.json()) as { tags?: Tag[] };
    return data.tags ?? [];
  },
  staleTime: STALE,
});

export const blogCategoriesQueryOptions = queryOptions({
  queryKey: ['categories'],
  queryFn: async (): Promise<Category[]> => {
    const res = await fetch(apiUrl('/api/categories'));
    if (!res.ok) throw new Error(`GET /api/categories ${res.status}`);
    const data = (await res.json()) as { categories?: Category[] };
    return data.categories ?? [];
  },
  staleTime: STALE,
});

// 分類詳情（含 description / short_description，文章頁 tooltip 用）。/api/categories 非 specta
// 端點，型別手寫。與上面窄版共用同一端點但不同 queryKey；文章頁只掛這個、不會雙抓。
export interface CategoryInfo {
  name?: string;
  short_description?: string;
  description?: string;
  post_count?: number;
  updated_at?: string;
  // 顯示用譯名（name 仍是資料鍵）。解析見 lib/categoryLabel 的 useCategoryLabel。
  name_en?: string;
  name_ja?: string;
  name_ko?: string;
  name_zh_cn?: string;
  description_en?: string;
  description_ja?: string;
  description_ko?: string;
  description_zh_cn?: string;
  short_description_en?: string;
  short_description_ja?: string;
  short_description_ko?: string;
  short_description_zh_cn?: string;
}
export const blogCategoriesDetailQueryOptions = queryOptions({
  queryKey: ['categories', 'detail'],
  queryFn: async (): Promise<CategoryInfo[]> => {
    const res = await fetch(apiUrl('/api/categories'));
    if (!res.ok) throw new Error(`GET /api/categories ${res.status}`);
    const data = (await res.json()) as { categories?: CategoryInfo[] };
    return data.categories ?? [];
  },
  staleTime: STALE,
});
