import { useState, useEffect, useMemo } from 'react';
import { gridFromContributions, gridFromEvents, uptimeSince, type ContributionCell } from '@/lib/contributionGrid';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import { usePageVisibility } from '@/contexts/pageVisibility';
import {
  steamQueryOptions,
  wakatimeQueryOptions,
  githubQueryOptions,
  contributionsQueryOptions,
  serverStatusQueryOptions,
} from '@/data/activityData';
import './Activity.css';

// 走後端的資料源（steam / wakatime / github user+events）改吃生成型別
// （backend handlers::thirdparty::*）。原本那批端點是「上游 JSON 原樣轉發」，
// 型別只存在這個檔案裡的手寫 interface；現在後端會塑形，型別跟著它走。
import type {
  SteamGame,
  SteamPlayer,
  SteamProfileResponse,
  WakatimeActualCodingTime,
  WakatimeGrandTotal,
  WakatimeStat,
  GithubUserResponse,
  GithubEvent,
  GithubRepo,
  GithubContributionsResponse,
} from '@koimsurai/api-types';

// 只再匯出真的有外部消費者的那個；其餘幾個是本檔自己在用，掛出去沒有人接。
export type { GithubEvent };
export type SteamProfile = SteamProfileResponse;
type GithubUser = GithubUserResponse;
export type GithubContributions = GithubContributionsResponse;

export interface ServerStatus {
  status: string;
  responseTime: number;
  lastCheck: Date;
}

// 以下三個是 **client 端把多支端點併起來的聚合形狀**，不是任何一支 API 的回應，
// 所以留在前端定義；元素型別才是後端來的。
export interface SteamData {
  recentGames?: SteamGame[];
  ownedGames?: SteamGame[];
  gameCount?: number;
  playerInfo?: SteamPlayer | null;
  configured?: boolean;
  error?: string;
}

export interface WakatimeData {
  today?: WakatimeGrandTotal | null;
  week?: { languages: WakatimeStat[]; projects: WakatimeStat[] } | null;
  actualCodingTime?: WakatimeActualCodingTime | null;
  configured?: boolean;
  error?: string;
}

export interface GithubData {
  user?: GithubUser;
  recentCommits?: GithubEvent[];
  recentRepos?: GithubRepo[];
  contributions?: GithubContributions | null;
  error?: string;
}

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
  const {
    data: contributions = null,
    isFetching: contributionsFetching,
    refetch: refetchContributions,
  } = useQuery(contributionsQueryOptions(contributionYear));
  const isRefreshing = contributionsFetching;
  const [currentTime, setCurrentTime] = useState(() => new Date());

  // 1 秒時鐘（非資料 → 維持 setInterval）。
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const getUptime = () => uptimeSince(new Date('2025-04-01T00:00:00+08:00'), new Date());

  // 熱力圖的格子計算抽在 lib/contributionGrid.ts（那裡也修掉了後備路徑兩軸反向的 bug）。
  const contributionData = useMemo<ContributionCell[][]>(
    () =>
      contributions?.contributions.length
        ? gridFromContributions(contributions.contributions)
        : gridFromEvents(githubData?.recentCommits ?? [], new Date()),
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
  // 原本是 `?? {}`：手寫型別每個欄位都可選才成立。改吃生成型別後欄位是 `string | null`，
  // 用 optional chaining 而不是捏一個假的空物件出來。
  const steamCust = steamProfile?.customization;
  const steamHasAnimAvatar = Boolean(steamCust?.animatedAvatar && steamCust.animatedAvatar !== steamCust.avatarFrame);
  const steamIsInGame = Boolean(steamData?.playerInfo?.gameid);
  const steamStateText = steamIsInGame
    ? t('activity.steam.ingame')
    : steamData?.playerInfo?.personastate === 1
      ? t('activity.steam.online')
      : t('activity.steam.offline');
  const sortedOwnedGames = steamData?.ownedGames
    ? [...steamData.ownedGames].sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0)).slice(0, 30)
    : [];
  // jogruber 的 total 是 `{ "2025": 842 }`，所以原本要 `total[Object.keys(total)[0]]`
  // 去挖第一個 key。改吃後端的 GraphQL 版之後它就是一個數字了。
  const contributionCount = contributions?.total ?? 0;
  // render 必須是純函式：new Date() 放進 state initializer（只在首次 render 求值）
  const [heatmapCurrentYear] = useState(() => new Date().getFullYear());
  const heatmapYears = [
    'last',
    String(heatmapCurrentYear),
    String(heatmapCurrentYear - 1),
    String(heatmapCurrentYear - 2),
  ];

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
        {/* 視覺上不出現，但頁面必須有 h1——這頁的排版從狀態列開始，原本整頁沒有任何
            h1（axe: page-has-heading-one）。螢幕閱讀器使用者進來會不知道自己在哪。 */}
        <h1 className="sr-only">{t('activity.title')}</h1>

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
              {serverStatus?.status === 'online'
                ? 'Server Online'
                : serverStatus?.status === 'offline'
                  ? 'Offline'
                  : 'Checking...'}
            </span>
            {(serverStatus?.responseTime ?? 0) > 0 && (
              <span className="status-bar-meta">{serverStatus?.responseTime}ms</span>
            )}
          </div>
          <div className="status-bar-right">
            {/* uptime / 時鐘用 new Date()，server 與 client render 時間不同 → suppressHydrationWarning */}
            <span className="status-bar-meta" suppressHydrationWarning>
              Uptime {uptime.days}d {uptime.hours}h
            </span>
            <span className="status-bar-time" suppressHydrationWarning>
              {currentTime.toLocaleTimeString(i18n.resolvedLanguage ?? 'zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
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
            <span className="hero-num">
              {githubData?.recentRepos?.reduce((s, r) => s + r.stargazers_count, 0) ?? 0}
            </span>
            <span className="hero-label">Stars</span>
          </div>
          <span className="hero-divider" />
          <div className="hero-number-item">
            <span className="hero-num">{wakatimeData?.today?.text ?? '0 hrs'}</span>
            <span className="hero-label">{t('activity.labels.codedToday')}</span>
          </div>
        </motion.div>

        {/* ─── Section 3a: Steam Profile — Steam hover-card 風格 ─── */}
        {steamData?.playerInfo && (
          <motion.a
            href={steamProfile?.profileUrl ?? steamData.playerInfo.profileurl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={`steam-profile-card ${steamIsInGame ? 'is-in-game' : ''} ${steamData.playerInfo.personastate === 1 ? 'is-online' : 'is-offline'}`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            {steamCust?.nameplateWebm && (
              <video
                className="steam-profile-bg"
                autoPlay
                muted
                loop
                playsInline
                poster={steamCust.nameplateMp4 ?? undefined}
              >
                <source src={steamCust.nameplateWebm} type="video/webm" />
                {steamCust.nameplateMp4 && <source src={steamCust.nameplateMp4} type="video/mp4" />}
              </video>
            )}
            <div className="steam-profile-overlay" />
            <div className="steam-profile-content">
              <div className="steam-profile-avatar-wrap">
                <img
                  src={(steamHasAnimAvatar ? steamCust?.animatedAvatar : steamData.playerInfo.avatarfull) ?? undefined}
                  alt="Steam avatar"
                  className="steam-profile-avatar"
                />
                {steamCust?.avatarFrame && (
                  <img className="steam-profile-avatar-frame" src={steamCust.avatarFrame} alt="" aria-hidden />
                )}
              </div>
              <div className="steam-profile-meta">
                <div className="steam-profile-name-row">
                  {/* h2 不是 h3：頁面只有一個 sr-only 的 h1，這是它底下的第一層區塊標題。
                        ⚠ 這個跳級**本機測不出來**——沒有 Steam 金鑰時整個區塊不 render，
                        所以是部署後對正式站跑 axe 才發現的。 */}
                  <h2 className="steam-profile-name">{steamData.playerInfo.personaname}</h2>
                  {steamProfile?.level != null && (
                    <span
                      className="steam-profile-level"
                      title={`${steamProfile.xp} XP · 還需 ${steamProfile.xpToNext} XP 升級`}
                    >
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
                {/* customization 一定在（Rust 那邊不是 Option），只有 featuredBadge 會沒有；
                      xp 也是必有的字串（miniprofile 上就是 "1,234 XP" 這種格式化過的值） */}
                {steamProfile?.customization.featuredBadge && (
                  <div className="steam-profile-featured" title={steamProfile.customization.featuredBadge.xp}>
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
              <h2 className="section-label">
                {steamData?.playerInfo?.gameid
                  ? t('activity.steam.playingTwoWeeks')
                  : t('activity.steam.recentTwoWeeks')}
              </h2>
              <span className="steam-recent-count">
                {t('activity.titlesUnit', { count: steamData?.recentGames?.length ?? 0 })}
              </span>
            </header>
            {/* 不掛 role="list"/"listitem"：原本 role="listitem" 蓋在 <a> 上會覆寫連結語意，
                報讀器不再說「連結」，反而比沒有 list 語意更糟。這裡是一排連結卡片，
                <a> 自己的語意就夠用；要補回 list 語意得改成 ul/li，但外層是
                grid-auto-flow:column，插一層 li 會讓 grid item 換人、版面跟著跑。 */}
            <div className="steam-recent-scroll">
              {steamData?.recentGames?.map((g, idx) => {
                const isCurrent = String(steamData.playerInfo?.gameid ?? '') === String(g.appid);
                return (
                  <a
                    key={g.appid}
                    href={`https://store.steampowered.com/app/${g.appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`steam-recent-card${isCurrent ? ' is-current' : ''}${idx === 0 && !isCurrent ? ' is-featured' : ''}`}
                  >
                    <div className="steam-recent-cover">
                      <img
                        src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`}
                        alt={g.name ?? ''}
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
                      <h3 className="steam-recent-title">{g.name}</h3>
                      <div className="steam-recent-stats">
                        <span>
                          {t('activity.playtime2w')} {formatPlaytime(g.playtime_2weeks ?? 0)}
                        </span>
                        <span className="steam-recent-divider">·</span>
                        <span>
                          {t('activity.playtimeTotal')} {formatPlaytime(g.playtime_forever ?? 0)}
                        </span>
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
              <h2 className="section-label">CODE PULSE</h2>
              <div className="code-pulse-today">{wakatimeData.today?.text ?? '0 hrs 0 mins'}</div>
              <span className="code-pulse-sub">{t('activity.wakatime.todayCoding')}</span>
            </div>
            <div className="code-pulse-right">
              {(wakatimeData.week?.languages.length ?? 0) > 0 ? (
                <div className="lang-bars">
                  {wakatimeData.week?.languages.slice(0, 5).map((lang, i) => (
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
                <a
                  href={githubData.user.html_url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="heatmap-profile"
                >
                  <img src={githubData.user.avatar_url ?? undefined} alt="GitHub" className="heatmap-avatar" />
                  <span>{githubData.user.name ?? githubData.user.login}</span>
                </a>
              )}
              {contributions && (
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 2v6h-6" />
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              </button>
            </div>
            <div className="heatmap-year-selector">
              {heatmapYears.map((y) => (
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
                {[0, 1, 2, 3, 4].map((l) => (
                  <div key={l} className={`legend-square level-${l}`} />
                ))}
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
            <h2 className="section-label">RECENT COMMITS</h2>
            <div className="commits-list">
              {(githubData?.recentCommits?.length ?? 0) === 0
                ? Array.from({ length: 4 }).map((_, i) => (
                    // 骨架屏佔位，載入完就整批換掉，不存在重排問題
                    // eslint-disable-next-line @eslint-react/no-array-index-key
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
                : githubData?.recentCommits?.slice(0, 8).map((event) => (
                    <div key={event.id} className="commit-event">
                      <div className="commit-event-header">
                        <div className="commit-dot" />
                        <span className="commit-repo">{event.repo.name.split('/')[1]}</span>
                        <span className="commit-when">{formatDate(event.created_at)}</span>
                      </div>
                      <div className="commit-messages">
                        {event.payload.commits.length > 0 ? (
                          <>
                            {event.payload.commits.slice(0, 3).map((commit) => (
                              <a
                                key={commit.sha}
                                className="commit-msg-row"
                                href={`https://github.com/${event.repo.name}/commit/${commit.sha}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <code className="commit-sha">{commit.sha.slice(0, 7)}</code>
                                <span className="commit-msg">{commit.message.split('\n')[0]}</span>
                              </a>
                            ))}
                            {event.payload.commits.length > 3 && (
                              <span className="commit-more">+{event.payload.commits.length - 3} more</span>
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
                            <span className="commit-msg">
                              Pushed {event.payload.size ?? 1} commit{(event.payload.size ?? 1) > 1 ? 's' : ''}
                            </span>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
            </div>
          </motion.div>
        )}

        {/* ─── Section 7: Projects time distribution ─── */}
        {(wakatimeData?.week?.projects.length ?? 0) > 0 && (
          <motion.div
            className="projects-section"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="section-label">WEEKLY PROJECTS</h2>
            <div className="projects-bars">
              {wakatimeData?.week?.projects.slice(0, 6).map((project, i) => (
                <div key={project.name} className="project-row">
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
              <h2 className="section-label">GAME LIBRARY</h2>
              <span className="game-gallery-count">{steamData?.gameCount} games</span>
            </div>
            <div className="game-marquee-wrapper">
              <div className="game-marquee-track">
                {[...sortedOwnedGames, ...sortedOwnedGames].map((game) => (
                  <a
                    key={game.appid}
                    href={`https://store.steampowered.com/app/${game.appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="game-gallery-item"
                  >
                    <img
                      src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`}
                      alt={game.name ?? ''}
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
            <h2 className="section-label">RECENT REPOS</h2>
            <div className="repos-list">
              {githubData?.recentRepos?.map((repo) => (
                <a key={repo.id} href={repo.html_url} target="_blank" rel="noopener noreferrer" className="repo-row">
                  <div className="repo-row-left">
                    <h3>{repo.name}</h3>
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
  const c: Record<string, string> = {
    JavaScript: '#f1e05a',
    TypeScript: '#2b7489',
    Python: '#3572A5',
    Java: '#b07219',
    'C++': '#f34b7d',
    C: '#555',
    Go: '#00ADD8',
    Rust: '#dea584',
    PHP: '#4F5D95',
    Ruby: '#701516',
    Swift: '#ffac45',
    Kotlin: '#F18E33',
    Dart: '#00B4AB',
    HTML: '#e34c26',
    CSS: '#563d7c',
  };
  return c[lang] ?? '#8257e6';
};

const getLanguageColorGradient = (lang: string) => {
  const g: Record<string, string> = {
    JavaScript: 'rgba(241,224,90,0.8),rgba(241,224,90,0.4)',
    TypeScript: 'rgba(43,116,137,0.8),rgba(43,116,137,0.4)',
    Python: 'rgba(53,114,165,0.8),rgba(53,114,165,0.4)',
    Java: 'rgba(176,114,25,0.8),rgba(176,114,25,0.4)',
    'C++': 'rgba(243,75,125,0.8),rgba(243,75,125,0.4)',
    C: 'rgba(85,85,85,0.8),rgba(85,85,85,0.4)',
    Go: 'rgba(0,173,216,0.8),rgba(0,173,216,0.4)',
    Rust: 'rgba(222,165,132,0.8),rgba(222,165,132,0.4)',
    PHP: 'rgba(79,93,149,0.8),rgba(79,93,149,0.4)',
    Ruby: 'rgba(112,21,22,0.8),rgba(112,21,22,0.4)',
    Swift: 'rgba(255,172,69,0.8),rgba(255,172,69,0.4)',
    Kotlin: 'rgba(241,142,51,0.8),rgba(241,142,51,0.4)',
    Dart: 'rgba(0,180,171,0.8),rgba(0,180,171,0.4)',
    HTML: 'rgba(227,76,38,0.8),rgba(227,76,38,0.4)',
    CSS: 'rgba(86,61,124,0.8),rgba(86,61,124,0.4)',
  };
  return g[lang] ?? 'rgba(130,87,230,0.8),rgba(130,87,230,0.4)';
};

export default Activity;
