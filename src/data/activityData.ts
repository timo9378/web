import { queryOptions } from '@tanstack/react-query';
import type {
  GithubEventsResponse,
  GithubReposResponse,
  GithubUserResponse,
  SteamGamesResponse,
  SteamPlayerResponse,
  SteamProfileResponse,
  WakatimeStatsResponse,
  WakatimeTodayResponse,
} from '@koimsurai/api-types';
import { apiUrl } from '@/lib/api';
import type {
  SteamData,
  SteamProfile,
  WakatimeData,
  GithubData,
  GithubEvent,
  GithubContributions,
  ServerStatus,
} from '@/components/media/Activity';

// Activity 儀表板資料改由 TanStack Query 管理（client-only、無 SSR loader）。
// 每個資料源各自一個 query → 進頁面立刻 render、各區到齊各補（取代「等全部 API 好才進」的全螢幕 loading）。
// 第三方端點（steam/github/wakatime）queryFn **不 throw**：{error, configured:false} 是合法狀態。
const STALE = 5 * 60 * 1000;
const DATA_REFRESH = 10 * 60 * 1000;
const STATUS_REFRESH = 30 * 1000;
const GITHUB_USERNAME = 'timo9378';

export const steamQueryOptions = queryOptions({
  queryKey: ['activity', 'steam'],
  queryFn: async (): Promise<{ steamData: SteamData; steamProfile: SteamProfile | null }> => {
    try {
      const [recentRes, playerRes, ownedRes, profileRes] = await Promise.all([
        fetch(apiUrl('/api/steam/recent-games')).then((r) => r.json() as Promise<SteamGamesResponse>),
        fetch(apiUrl('/api/steam/player')).then((r) => r.json() as Promise<SteamPlayerResponse>),
        fetch(apiUrl('/api/steam/owned-games')).then((r) => r.json() as Promise<SteamGamesResponse>),
        fetch(apiUrl('/api/steam/profile'))
          .then((r) => (r.ok ? (r.json() as Promise<SteamProfileResponse>) : null))
          .catch(() => null),
      ]);
      if (recentRes.error ?? playerRes.error) {
        return {
          steamData: { error: recentRes.error ?? playerRes.error ?? undefined, configured: false },
          steamProfile: null,
        };
      }
      return {
        steamData: {
          recentGames: recentRes.games,
          ownedGames: ownedRes.games,
          gameCount: ownedRes.gameCount ?? 0,
          playerInfo: playerRes.player,
          configured: true,
        },
        // profile 端點抓不到時回 503（上面已轉成 null），成功就一定是完整的 profile
        steamProfile: profileRes,
      };
    } catch {
      return { steamData: { error: 'backend', configured: false }, steamProfile: null };
    }
  },
  staleTime: STALE,
  refetchInterval: DATA_REFRESH,
});

export const wakatimeQueryOptions = queryOptions({
  queryKey: ['activity', 'wakatime'],
  queryFn: async (): Promise<WakatimeData> => {
    try {
      const [todayRes, weekRes] = await Promise.all([
        fetch(apiUrl('/api/wakatime/today')).then((r) => r.json() as Promise<WakatimeTodayResponse>),
        fetch(apiUrl('/api/wakatime/week')).then((r) => r.json() as Promise<WakatimeStatsResponse>),
      ]);
      if (todayRes.error ?? weekRes.error) {
        return { error: todayRes.error ?? weekRes.error ?? undefined, configured: false };
      }
      return {
        today: todayRes.grand_total,
        week: { languages: weekRes.languages, projects: weekRes.projects },
        actualCodingTime: todayRes.actualCodingTime,
        configured: true,
      };
    } catch {
      return { error: 'backend', configured: false };
    }
  },
  staleTime: STALE,
  refetchInterval: DATA_REFRESH,
});

export const githubQueryOptions = queryOptions({
  queryKey: ['activity', 'github'],
  queryFn: async (): Promise<GithubData> => {
    try {
      // repos 以前是瀏覽器直接打 api.github.com（未認證、60 req/hr 算在讀者 IP 上），
      // 現在跟 user/events 一樣走後端，吃 GITHUB_TOKEN 的額度。
      const [userData, eventsData, reposData] = await Promise.all([
        fetch(apiUrl(`/api/github/user/${GITHUB_USERNAME}`)).then((r) => r.json() as Promise<GithubUserResponse>),
        fetch(apiUrl(`/api/github/events/${GITHUB_USERNAME}`)).then((r) => r.json() as Promise<GithubEventsResponse>),
        fetch(apiUrl(`/api/github/repos/${GITHUB_USERNAME}?limit=5`)).then(
          (r) => r.json() as Promise<GithubReposResponse>,
        ),
      ]);
      if (userData.error ?? eventsData.error) return { error: userData.error ?? eventsData.error ?? undefined };
      const pushEvents = eventsData.events.filter((e: GithubEvent) => e.type === 'PushEvent').slice(0, 10);
      // repos 抓不到不算整區失敗（本來就是次要資訊，原本也是 .catch(() => [])）
      return { user: userData, recentCommits: pushEvents, recentRepos: reposData.repos };
    } catch {
      return { error: 'backend' };
    }
  },
  staleTime: STALE,
  refetchInterval: DATA_REFRESH,
});

// contributions：原本打第三方的 jogruber（一個爬 GitHub 個人頁 HTML 的服務），
// 改走後端的 GraphQL contributionsCollection —— GitHub 官方就有這份資料，
// 我們也本來就有 token，所以不是把 jogruber 代理起來，是不需要它了。
// 依年份參數化 → 年份選擇器 = 換 queryKey 自動 refetch。
export const contributionsQueryOptions = (year: string) =>
  queryOptions({
    queryKey: ['activity', 'contributions', year],
    queryFn: async (): Promise<GithubContributions | null> => {
      try {
        const res = await fetch(apiUrl(`/api/github/contributions/${GITHUB_USERNAME}?year=${year}`));
        const data = (await res.json()) as GithubContributions;
        return data.error ? null : data;
      } catch {
        return null;
      }
    },
    staleTime: STALE,
  });

// server status：量測 /health 回應時間；30 秒 refetchInterval。
export const serverStatusQueryOptions = queryOptions({
  queryKey: ['activity', 'server-status'],
  queryFn: async (): Promise<ServerStatus> => {
    const startTime = Date.now();
    try {
      const res = await fetch(apiUrl('/api/health'));
      const responseTime = Date.now() - startTime;
      return { status: res.ok ? 'online' : 'error', responseTime, lastCheck: new Date() };
    } catch {
      return { status: 'offline', responseTime: 0, lastCheck: new Date() };
    }
  },
  staleTime: 0,
  refetchInterval: STATUS_REFRESH,
});
