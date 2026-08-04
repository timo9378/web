// 預抓 BlogPost 路由 chunk，降低點擊後的感知延遲。
// 文章 JSON 的預抓改由 TanStack Query（queryClient.prefetchQuery，見 usePreviewLink / Blog），
// 這裡只負責 lazy chunk 熱身，避免和 Query 各抓一次 JSON。

let chunkPromise: Promise<unknown> | null = null;

export function prefetchPostChunk(): Promise<unknown> | null {
  if (chunkPromise) return chunkPromise;
  chunkPromise = import('@/components/blog/BlogPost').catch(() => { chunkPromise = null; });
  return chunkPromise;
}

// 舊名保留為 alias（呼叫端漸進換名），只做 chunk 預抓。
export function prefetchPost(_id?: string | number, _lang?: string) {
  void prefetchPostChunk();
}
