import { queryOptions } from '@tanstack/react-query';
import type { SubscriberByToken } from '@koimsurai/api-types';
import { apiUrl } from '@/lib/api';

// 退訂頁的 token 驗證讀取。!res.ok（404 invalid token）時 throw 帶伺服器訊息 →
// 元件用 isError + error.message 還原原本的錯誤文案。retry 關掉（無效 token 重試無意義）。
export const subscriberByTokenQueryOptions = (token: string) =>
  queryOptions({
    queryKey: ['newsletter', 'by-token', token],
    queryFn: async (): Promise<SubscriberByToken> => {
      const res = await fetch(apiUrl(`/api/newsletter/by-token/${encodeURIComponent(token)}`));
      const data = (await res.json()) as SubscriberByToken & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '');
      return data;
    },
    staleTime: 0,
    retry: false,
  });
