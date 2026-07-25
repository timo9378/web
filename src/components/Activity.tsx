import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import { usePageVisibility } from '../contexts/PageVisibilityContext';
import {
  steamQueryOptions,
  wakatimeQueryOptions,
  githubQueryOptions,
  contributionsQueryOptions,
  serverStatusQueryOptions,
} from '../activityData';
import './Activity.css';

export interface ServerStatus { status: string; responseTime: number; lastCheck: Date }

export interface SteamGame { appid: number; name: string; playtime_2weeks?: number; playtime_forever?: number }
export interface SteamPlayer {
  gameid?: string | number;
  personastate?: number;
  personaname?: string;
  avatarfull?: string;
  profileurl?: string;
}
export interface SteamData {
  recentGames?: SteamGame[];
  ownedGames?: SteamGame[];
  gameCount?: number;
  playerInfo?: SteamPlayer | null;
  configured?: boolean;
  error?: string;
}
interface SteamFeaturedBadge { xp?: string | number; icon?: string; name?: string }
interface SteamCustomization {
  animatedAvatar?: string;
  avatarFrame?: string;
  nameplateWebm?: string;
  nameplateMp4?: string;
  featuredBadge?: SteamFeaturedBadge;
}
export interface SteamProfile {
  customization?: SteamCustomization;
  profileUrl?: string;
  level?: number;
  xp?: number;
  xpToNext?: number;
  badgeCount?: number;
  error?: string;
}

export interface WakatimeToday { grand_total?: { text?: string } }
interface WakatimeStat { name: string; text: string; percent: number }
export interface WakatimeWeek { languages?: WakatimeStat[]; projects?: WakatimeStat[] }
export interface WakatimeData {
  today?: WakatimeToday | null;
  week?: WakatimeWeek | null;
  actualCodingTime?: unknown;
  configured?: boolean;
  error?: string;
}

export interface GithubUser { public_repos?: number; html_url?: string; avatar_url?: string; name?: string; login?: string }
export interface GithubRepo { id: number; html_url: string; name: string; description?: string; language?: string; stargazers_count: number }
interface GithubCommit { sha: string; message: string }
interface GithubEventPayload { commits?: GithubCommit[]; before?: string; head?: string; size?: number }
export interface GithubEvent { id: string; type: string; repo: { name: string }; created_at: string; payload: GithubEventPayload }
interface GithubContributionDay { date: string; count: number }
export interface GithubContributions { total?: Record<string, number>; contributions?: GithubContributionDay[] }
export interface GithubData {
  user?: GithubUser;
  recentCommits?: GithubEvent[];
  recentRepos?: GithubRepo[];
  contributions?: GithubContributions | null;
  error?: string;
}

interface ContributionCell { date: string; count: number; level: number }

const Activity = () => {
  const { t, i18n } = useTranslation();
  const { isVisible } = usePageVisibility();
  // 資料改由 TanStack Query 管理：每個資料源各自一個 query → 進頁面立刻 render、各區到齊各補
  // （取代舊的「等 steam+github+wakatime 全部 API 好才進」的全螢幕 loading gate）。
  const { data: steam } = useQuery(steamQueryOptions);
  const steamData = steam?.steamData ?? null;
  const steamProfile = steam?.steamProfile ?? null;
  const { data: wakatimeData = null } = useQuery(wakatimeQueryOptions);
  const { data: githubData = null, isLoading: githubLoading } = useQuery(githubQueryOptions);
  const { data: serverStatus = null } = useQuery(serverStatusQueryOptions);
  const [contributionYear, setContributionYear] = useState('last');
  const { data: contributions = null, isFetching: contributionsFetching, refetch: refetchContributions } =
    useQuery(contributionsQueryOptions(contributionYear));
  const isRefreshing = contributionsFetching;
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // 1 秒時鐘（非資料 → 維持 setInterval）。
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const getUptime = () => {
    const startDate = new Date('2025-04-01T00:00:00+08:00');
    const diffTime = Math.abs(new Date().getTime() - startDate.getTime());
    return {
      days: Math.floor(diffTime / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    };
  };

  // contribution 熱力圖格子（純函式，回傳格子；優先 jogruber contributions，沒有就用 push events 推）。
  const gridFromContributions = (apiData: GithubContributions): ContributionCell[][] => {
    if (!apiData.contributions) return [];
    const contributions = apiData.contributions;
    const data: ContributionCell[][] = [];
    const totalWeeks = Math.ceil(contributions.length / 7);
    for (let i = 0; i < totalWeeks; i++) {
      const weekData: ContributionCell[] = [];
      for (let j = 0; j < 7; j++) {
        const idx = i * 7 + j;
        if (idx < contributions.length) {
          const day = contributions[idx];
          const count = day.count || 0;
          weekData.push({ date: day.date, count, level: count === 0 ? 0 : count <= 3 ? 1 : count <= 6 ? 2 : count <= 9 ? 3 : 4 });
        } else {
          weekData.push({ date: '', count: 0, level: -1 });
        }
      }
      data.push(weekData);
    }
    return data;
  };

  const gridFromEvents = (events: GithubEvent[]): ContributionCell[][] => {
    const data: ContributionCell[][] = [];
    const today = new Date();
    const commitsByDate: Record<string, number> = {};
    events.forEach(e => {
      if (e.type === 'PushEvent') {
        const d = new Date(e.created_at).toDateString();
        commitsByDate[d] = (commitsByDate[d] ?? 0) + (e.payload.commits?.length ?? 1);
      }
    });
    for (let week = 51; week >= 0; week--) {
      const weekData: ContributionCell[] = [];
      for (let day = 0; day < 7; day++) {
        const d = new Date(today);
        d.setDate(d.getDate() - (week * 7 + day));
        const ds = d.toDateString();
        const count = commitsByDate[ds] ?? 0;
        weekData.push({ date: ds, count, level: count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 8 ? 3 : 4 });
      }
      data.push(weekData);
    }
    return data.reverse();
  };

  const contributionData = useMemo<ContributionCell[][]>(
    () => (contributions?.contributions ? gridFromContributions(contributions) : gridFromEvents(githubData?.recentCommits ?? [])),
    [contributions, githubData],
  );

  const formatPlaytime = (m: number) => {
    const h = Math.floor(m / 60);
    return h < 1 ? `${m} ${t('activity.units.min')}` : `${h} ${t('activity.units.hr')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const diffMs = new Date().getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 60) return `${diffMins} 分鐘前`;
    if (diffHours < 24) return `${diffHours} 小時前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-TW');
  };

  const uptime = getUptime();

  // ── 從 JSX 中抽出來的衍生值（避免 JSX 內 IIFE）──
  const steamCust: SteamCustomization = steamProfile?.customization ?? {};
  const steamHasAnimAvatar = Boolean(steamCust.animatedAvatar && steamCust.animatedAvatar !== steamCust.avatarFrame);
  const steamIsInGame = Boolean(steamData?.playerInfo?.gameid);
  const steamStateText = steamIsInGame
    ? t('activity.steam.ingame')
    : (steamData?.playerInfo?.personastate === 1 ? t('activity.steam.online') : t('activity.steam.offline'));
  const sortedOwnedGames = steamData?.ownedGames
    ? [...steamData.ownedGames].sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0)).slice(0, 30)
    : [];
  const contributionTotal = contributions?.total;
  const contributionCount = contributionTotal ? (contributionTotal[Object.keys(contributionTotal)[0]] ?? 0) : 0;
  // render 必須是純函式：new Date() 放進 state initializer（只在首次 render 求值）
  const [heatmapCurrentYear] = useState(() => new Date().getFullYear());
  const heatmapYears = ['last', String(heatmapCurrentYear), String(heatmapCurrentYear - 1), String(heatmapCurrentYear - 2)];

  // 不再等所有 API 好才進頁面：各區靠自己的 query 資料條件渲染（null → 先隱藏，到齊再補），
  // 進頁面立刻 render 骨架 + nebula 背景，比舊的全螢幕 loading gate 快很多。
  return (
    <div className={`activity-page ${!isVisible ? 'is-hidden' : ''}`}>

      <div className="activity-dim-overlay" />
      <div className="activity-nebula-bg">
        <div className="nebula-layer activity-nebula-1" />
        <div className="nebula-layer activity-nebula-2" />
        <div className="nebula-layer activity-nebula-3" />
        <div className="activity-nebula-dust" />
      </div>

      <div className="activity-content-wrapper">

        {/* ─── Section 1: Status Bar ─── */}
        <motion.div
          className="status-bar"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="status-bar-left">
            <div className={`status-dot-inline ${serverStatus?.status ?? 'checking'}`} />
            <span className="status-bar-text">
              {serverStatus?.status === 'online' ? 'Server Online' : serverStatus?.status === 'offline' ? 'Offline' : 'Checking...'}
            </span>
            {(serverStatus?.responseTime ?? 0) > 0 && (
              <span className="status-bar-meta">{serverStatus?.responseTime}ms</span>
            )}
          </div>
          <div className="status-bar-right">
            {/* uptime / 時鐘用 new Date()，server 與 client render 時間不同 → suppressHydrationWarning */}
            <span className="status-bar-meta" suppressHydrationWarning>Uptime {uptime.days}d {uptime.hours}h</span>
            <span className="status-bar-time" suppressHydrationWarning>
              {currentTime.toLocaleTimeString(i18n.resolvedLanguage ?? 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </span>
          </div>
        </motion.div>

        {/* ─── Section 2: Hero Numbers ─── */}
        <motion.div
          className="hero-numbers"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <div className="hero-number-item">
            <span className="hero-num">{steamData?.gameCount ?? 0}</span>
            <span className="hero-label">{t('activity.labels.gameCollection')}</span>
          </div>
          <span className="hero-divider" />
          <div className="hero-number-item">
            <span className="hero-num">{githubData?.user?.public_repos ?? 0}</span>
            <span className="hero-label">{t('activity.labels.publicProjects')}</span>
          </div>
          <span className="hero-divider" />
          <div className="hero-number-item">
            <span className="hero-num">{githubData?.recentRepos?.reduce((s, r) => s + r.stargazers_count, 0) ?? 0}</span>
            <span className="hero-label">Stars</span>
          </div>
          <span className="hero-divider" />
          <div className="hero-number-item">
            <span className="hero-num">{wakatimeData?.today?.grand_total?.text ?? '0 hrs'}</span>
            <span className="hero-label">{t('activity.labels.codedToday')}</span>
          </div>
        </motion.div>

        {/* ─── Section 3a: Steam Profile — Steam hover-card 風格 ─── */}
        {steamData?.playerInfo && (
            <motion.a
              href={steamProfile?.profileUrl ?? steamData.playerInfo.profileurl}
              target="_blank"
              rel="noopener noreferrer"
              className={`steam-profile-card ${steamIsInGame ? 'is-in-game' : ''} ${steamData.playerInfo.personastate === 1 ? 'is-online' : 'is-offline'}`}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              {steamCust.nameplateWebm && (
                <video
                  className="steam-profile-bg"
                  autoPlay muted loop playsInline
                  poster={steamCust.nameplateMp4}
                >
                  <source src={steamCust.nameplateWebm} type="video/webm" />
                  {steamCust.nameplateMp4 && <source src={steamCust.nameplateMp4} type="video/mp4" />}
                </video>
              )}
              <div className="steam-profile-overlay" />
              <div className="steam-profile-content">
                <div className="steam-profile-avatar-wrap">
                  <img
                    src={steamHasAnimAvatar ? steamCust.animatedAvatar : steamData.playerInfo.avatarfull}
                    alt="Steam avatar"
                    className="steam-profile-avatar"
                  />
                  {steamCust.avatarFrame && (
                    <img className="steam-profile-avatar-frame" src={steamCust.avatarFrame} alt="" aria-hidden />
                  )}
                </div>
                <div className="steam-profile-meta">
                  <div className="steam-profile-name-row">
                    <h3 className="steam-profile-name">{steamData.playerInfo.personaname}</h3>
                    {steamProfile?.level != null && (
                      <span className="steam-profile-level" title={`${steamProfile.xp} XP · 還需 ${steamProfile.xpToNext} XP 升級`}>
                        Lv.{steamProfile.level}
                      </span>
                    )}
                  </div>
                  <div className="steam-profile-status">
                    <span className="steam-profile-dot" />
                    {steamStateText}
                    <span className="steam-profile-divider">·</span>
                    {t('activity.gamesUnit', { count: steamData.gameCount })}
                    {steamProfile?.badgeCount ? (
                      <>
                        <span className="steam-profile-divider">·</span>
                        {t('activity.badgesUnit', { count: steamProfile.badgeCount })}
                      </>
                    ) : null}
                  </div>
                  {steamProfile?.customization?.featuredBadge && (
                    <div className="steam-profile-featured" title={String(steamProfile.customization.featuredBadge.xp ?? '')}>
                      <img src={steamProfile.customization.featuredBadge.icon} alt="" />
                      <span>{steamProfile.customization.featuredBadge.name}</span>
                    </div>
                  )}
                </div>
                <span className="koim-btn steam-profile-cta-btn">
                  Steam<span aria-hidden>→</span>
                </span>
              </div>
            </motion.a>
        )}

        {/* ─── Section 3b: 最近遊玩 — horizontal snap scroll ─── */}
        {(steamData?.recentGames?.length ?? 0) > 0 && (
          <motion.section
            className="steam-recent-section"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.05 }}
          >
            <header className="steam-recent-header">
              <span className="section-label">
                {steamData?.playerInfo?.gameid ? t('activity.steam.playingTwoWeeks') : t('activity.steam.recentTwoWeeks')}
              </span>
              <span className="steam-recent-count">{t('activity.titlesUnit', { count: steamData?.recentGames?.length ?? 0 })}</span>
            </header>
            <div className="steam-recent-scroll" role="list">
              {steamData?.recentGames?.map((g, idx) => {
                const isCurrent = String(steamData.playerInfo?.gameid ?? '') === String(g.appid);
                return (
                  <a
                    key={g.appid}
                    href={`https://store.steampowered.com/app/${g.appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`steam-recent-card${isCurrent ? ' is-current' : ''}${idx === 0 && !isCurrent ? ' is-featured' : ''}`}
                    role="listitem"
                  >
                    <div className="steam-recent-cover">
                      <img
                        src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`}
                        alt={g.name}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          // header.jpg 沒上的新遊戲 fallback：嘗試 capsule，再不行就藏起來露出 placeholder 漸層
                          const img = e.currentTarget;
                          if (!img.dataset.fallback) {
                            img.dataset.fallback = '1';
                            img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_231x87.jpg`;
                          } else {
                            img.style.display = 'none';
                            img.parentElement?.classList.add('is-fallback');
                          }
                        }}
                      />
                    </div>
                    <div className="steam-recent-overlay" />
                    {isCurrent && <span className="steam-recent-pulse">{t('activity.steam.ingame')}</span>}
                    <div className="steam-recent-info">
                      <h4 className="steam-recent-title">{g.name}</h4>
                      <div className="steam-recent-stats">
                        <span>{t('activity.playtime2w')} {formatPlaytime(g.playtime_2weeks ?? 0)}</span>
                        <span className="steam-recent-divider">·</span>
                        <span>{t('activity.playtimeTotal')} {formatPlaytime(g.playtime_forever ?? 0)}</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* ─── Section 4: Code Pulse — split layout ─── */}
        {wakatimeData && !wakatimeData.error && (
          <motion.div
            className="code-pulse-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="code-pulse-left">
              <span className="section-label">CODE PULSE</span>
              <div className="code-pulse-today">
                {wakatimeData.today?.grand_total?.text ?? '0 hrs 0 mins'}
              </div>
              <span className="code-pulse-sub">{t('activity.wakatime.todayCoding')}</span>
            </div>
            <div className="code-pulse-right">
              {(wakatimeData.week?.languages?.length ?? 0) > 0 ? (
                <div className="lang-bars">
                  {wakatimeData.week?.languages?.slice(0, 5).map((lang, i) => (
                    <div key={lang.name} className="lang-bar-row">
                      <div className="lang-bar-meta">
                        <span className="lang-bar-name">{lang.name}</span>
                        <span className="lang-bar-time">{lang.text}</span>
                      </div>
                      <div className="lang-bar-track">
                        <motion.div
                          className="lang-bar-fill"
                          initial={{ width: 0 }}
                          whileInView={{ width: `${lang.percent}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, delay: i * 0.1 }}
                          style={{ background: `linear-gradient(90deg, ${getLanguageColorGradient(lang.name)})` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-data-small">{t('activity.wakatime.noDataWeek')}</p>
              )}
            </div>
          </motion.div>
        )}

        {/* ─── Section 5: Contribution Heatmap — standalone ─── */}
        {contributionData.length > 0 && (
          <motion.div
            className="heatmap-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="heatmap-section-header">
              {githubData?.user && (
                <a href={githubData.user.html_url} target="_blank" rel="noopener noreferrer" className="heatmap-profile">
                  <img src={githubData.user.avatar_url} alt="GitHub" className="heatmap-avatar" />
                  <span>{githubData.user.name ?? githubData.user.login}</span>
                </a>
              )}
              {contributionTotal && (
                  <div className="heatmap-total">
                    {contributionYear === 'last' ? (
                      <Trans
                        i18nKey="activity.github.contributions"
                        values={{ count: contributionCount }}
                        components={{ b: <span className="heatmap-total-num" /> }}
                      />
                    ) : (
                      <>
                        <span className="heatmap-total-num">{contributionCount}</span>
                        <span className="heatmap-total-label">contributions in {contributionYear}</span>
                      </>
                    )}
                  </div>
              )}
              <button
                type="button"
                className={`koim-btn koim-btn--icon koim-btn--sm${isRefreshing ? ' is-refreshing' : ''}`}
                onClick={(e) => {
                  e.currentTarget.blur(); // 點完離焦，避免桌面瀏覽器把 :focus 視為持續 hover
                  void refetchContributions();
                }}
                disabled={isRefreshing}
                title={t('activity.refresh')}
                aria-label="刷新貢獻圖"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              </button>
            </div>
            <div className="heatmap-year-selector">
              {heatmapYears.map(y => (
                <button
                  key={y}
                  type="button"
                  className={`koim-btn koim-btn--sm${contributionYear === y ? ' is-active' : ''}`}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    if (contributionYear === y) return;
                    // 換年份 → contributionsQueryOptions(y) 的 queryKey 變 → 自動 refetch。
                    setContributionYear(y);
                  }}
                >
                  {y === 'last' ? t('activity.github.lastYear') : y}
                </button>
              ))}
            </div>
            <div className={`heatmap-grid-wrapper${isRefreshing ? ' is-refreshing' : ''}`}>
              {isRefreshing && (
                <div className="heatmap-refresh-overlay" aria-hidden>
                  <div className="koim-loader" aria-hidden>
                    <div className="koim-loader-orbit koim-loader-orbit-1" />
                    <div className="koim-loader-orbit koim-loader-orbit-2" />
                    <div className="koim-loader-core" />
                    <div className="koim-loader-glow" />
                  </div>
                </div>
              )}
              <div className="heatmap-grid">
                {contributionData.map((week) => (
                  <div key={week[0]?.date} className="heatmap-week">
                    {week.map((day) => (
                      <div key={day.date} className={`heatmap-day level-${day.level}`}>
                        <div className="day-tooltip">
                          <div>{day.count} commits</div>
                          <div className="tooltip-date">{day.date}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="heatmap-legend">
              <span>Less</span>
              <div className="legend-squares">
                {[0, 1, 2, 3, 4].map(l => <div key={l} className={`legend-square level-${l}`} />)}
              </div>
              <span>More</span>
            </div>
          </motion.div>
        )}

        {/* ─── Section 6: Recent Commits — minimal timeline ─── */}
        {/* github commit 牆最慢 → 載入中放骨架佔位（保留版面高度），避免「整個消失→載完瞬間彈出」。 */}
        {(githubLoading || (githubData?.recentCommits?.length ?? 0) > 0) && (
          <motion.div
            className="commits-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <span className="section-label">RECENT COMMITS</span>
            <div className="commits-list">
              {(githubData?.recentCommits?.length ?? 0) === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={`sk-${i}`} className="commit-event commit-skeleton" aria-hidden>
                      <div className="commit-event-header">
                        <div className="commit-dot" />
                        <span className="commit-repo sk-box" />
                        <span className="commit-when sk-box" />
                      </div>
                      <div className="commit-messages">
                        <span className="sk-box sk-line" />
                        <span className="sk-box sk-line" />
                      </div>
                    </div>
                  ))
                : githubData?.recentCommits?.slice(0, 8).map((event, i) => (
                <div key={`${event.id}-${i}`} className="commit-event">
                  <div className="commit-event-header">
                    <div className="commit-dot" />
                    <span className="commit-repo">{event.repo.name.split('/')[1]}</span>
                    <span className="commit-when">{formatDate(event.created_at)}</span>
                  </div>
                  <div className="commit-messages">
                    {(event.payload.commits ?? []).length > 0 ? (
                      <>
                        {event.payload.commits?.slice(0, 3).map((commit, ci) => (
                          <a
                            key={ci}
                            className="commit-msg-row"
                            href={`https://github.com/${event.repo.name}/commit/${commit.sha}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <code className="commit-sha">{commit.sha.slice(0, 7)}</code>
                            <span className="commit-msg">{commit.message.split('\n')[0]}</span>
                          </a>
                        ))}
                        {(event.payload.commits?.length ?? 0) > 3 && (
                          <span className="commit-more">+{(event.payload.commits?.length ?? 0) - 3} more</span>
                        )}
                      </>
                    ) : (
                      <a
                        className="commit-msg-row"
                        href={`https://github.com/${event.repo.name}/compare/${event.payload.before?.slice(0, 7)}...${event.payload.head?.slice(0, 7)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <code className="commit-sha">{event.payload.head?.slice(0, 7) ?? '—'}</code>
                        <span className="commit-msg">Pushed {event.payload.size ?? 1} commit{(event.payload.size ?? 1) > 1 ? 's' : ''}</span>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ─── Section 7: Projects time distribution ─── */}
        {(wakatimeData?.week?.projects?.length ?? 0) > 0 && (
          <motion.div
            className="projects-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <span className="section-label">WEEKLY PROJECTS</span>
            <div className="projects-bars">
              {wakatimeData?.week?.projects?.slice(0, 6).map((project, i) => (
                <div key={i} className="project-row">
                  <div className="project-row-meta">
                    <span className="project-row-name">{project.name}</span>
                    <span className="project-row-time">{project.text}</span>
                  </div>
                  <div className="project-row-track">
                    <motion.div
                      className="project-row-fill"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${project.percent}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, delay: i * 0.06 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ─── Section 8: Game Gallery — auto-scroll marquee ─── */}
        {(steamData?.ownedGames?.length ?? 0) > 0 && (
            <motion.div
              className="game-gallery-section"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="game-gallery-header">
                <span className="section-label">GAME LIBRARY</span>
                <span className="game-gallery-count">{steamData?.gameCount} games</span>
              </div>
              <div className="game-marquee-wrapper">
                <div className="game-marquee-track">
                  {[...sortedOwnedGames, ...sortedOwnedGames].map((game, i) => (
                    <a
                      key={`${game.appid}-${i}`}
                      href={`https://store.steampowered.com/app/${game.appid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="game-gallery-item"
                    >
                      <img
                        src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`}
                        alt={game.name}
                        loading="lazy"
                        onError={(e) => {
                          // header.jpg 沒上 → 試 capsule；capsule 也失敗 → 藏 img（露出 placeholder），
                          // 不再讓破圖 + alt 文字閃（跟 steam-recent-cover 同一套 fallback）。
                          const img = e.currentTarget;
                          if (!img.dataset.fallback) {
                            img.dataset.fallback = '1';
                            img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/capsule_616x353.jpg`;
                          } else {
                            img.style.display = 'none';
                            img.parentElement?.classList.add('is-fallback');
                          }
                        }}
                      />
                      <div className="game-gallery-info">
                        <span>{game.name}</span>
                        <span className="game-gallery-time">{formatPlaytime(game.playtime_forever ?? 0)}</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </motion.div>
        )}

        {/* ─── Section 9: Repos — simple list ─── */}
        {(githubData?.recentRepos?.length ?? 0) > 0 && (
          <motion.div
            className="repos-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <span className="section-label">RECENT REPOS</span>
            <div className="repos-list">
              {githubData?.recentRepos?.map(repo => (
                <a key={repo.id} href={repo.html_url} target="_blank" rel="noopener noreferrer" className="repo-row">
                  <div className="repo-row-left">
                    <h4>{repo.name}</h4>
                    <p>{repo.description ?? '沒有描述'}</p>
                  </div>
                  <div className="repo-row-right">
                    {repo.language && (
                      <span className="repo-lang">
                        <span className="lang-dot" style={{ backgroundColor: getLanguageColor(repo.language) }} />
                        {repo.language}
                      </span>
                    )}
                    <span>⭐ {repo.stargazers_count}</span>
                  </div>
                </a>
              ))}
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
};

const getLanguageColor = (lang: string) => {
  const c: Record<string, string> = { JavaScript:'#f1e05a', TypeScript:'#2b7489', Python:'#3572A5', Java:'#b07219', 'C++':'#f34b7d', C:'#555', Go:'#00ADD8', Rust:'#dea584', PHP:'#4F5D95', Ruby:'#701516', Swift:'#ffac45', Kotlin:'#F18E33', Dart:'#00B4AB', HTML:'#e34c26', CSS:'#563d7c' };
  return c[lang] ?? '#8257e6';
};

const getLanguageColorGradient = (lang: string) => {
  const g: Record<string, string> = { JavaScript:'rgba(241,224,90,0.8),rgba(241,224,90,0.4)', TypeScript:'rgba(43,116,137,0.8),rgba(43,116,137,0.4)', Python:'rgba(53,114,165,0.8),rgba(53,114,165,0.4)', Java:'rgba(176,114,25,0.8),rgba(176,114,25,0.4)', 'C++':'rgba(243,75,125,0.8),rgba(243,75,125,0.4)', C:'rgba(85,85,85,0.8),rgba(85,85,85,0.4)', Go:'rgba(0,173,216,0.8),rgba(0,173,216,0.4)', Rust:'rgba(222,165,132,0.8),rgba(222,165,132,0.4)', PHP:'rgba(79,93,149,0.8),rgba(79,93,149,0.4)', Ruby:'rgba(112,21,22,0.8),rgba(112,21,22,0.4)', Swift:'rgba(255,172,69,0.8),rgba(255,172,69,0.4)', Kotlin:'rgba(241,142,51,0.8),rgba(241,142,51,0.4)', Dart:'rgba(0,180,171,0.8),rgba(0,180,171,0.4)', HTML:'rgba(227,76,38,0.8),rgba(227,76,38,0.4)', CSS:'rgba(86,61,124,0.8),rgba(86,61,124,0.4)' };
  return g[lang] ?? 'rgba(130,87,230,0.8),rgba(130,87,230,0.4)';
};

export default Activity;
