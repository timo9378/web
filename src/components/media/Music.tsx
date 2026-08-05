import { useState, useEffect, useRef, type CSSProperties } from 'react';
// ⚠ 改名匯入：這個檔案裡本來就有一個叫 trackAnalytics 的區域變數（算好的結果）。
import { trackAnalytics as computeTrackAnalytics } from '@/lib/trackAnalytics';
import { useQuery } from '@tanstack/react-query';
import {
  recentlyPlayedQueryOptions,
  topGenresQueryOptions,
  topTracksQueryOptions,
  nowPlayingQueryOptions,
  audioFeaturesQueryOptions,
} from '@/data/musicData';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import KoimLoader from '@/components/common/KoimLoader';
import './Music.css';
import type {
  NowPlayingResponse, RecentPlayItem, SpotifyTrack, TopGenre,
} from '@koimsurai/api-types';

interface RGB { r: number; g: number; b: number }

// Spotify 相關型別全部改吃後端 specta 生成的（backend handlers::spotify）。
// 後端不再原樣轉發 Spotify 的 JSON，而是先反序列化成自己的形狀再送出 ——
// 型別由 Rust 定義、CI 的 drift gate 擋不同步，前端不再照著第三方文件手寫。
// configured / error 是前端自己的載入狀態，不是 API 形狀，留在這裡。
export type { AudioFeature } from '@koimsurai/api-types';
export type NowPlaying = NowPlayingResponse;
// 前端合成：沒在播時拿「最近播放」頂上顯示，因此多一個 played_at（API 本身沒有這欄）
interface NowPlayingData extends NowPlayingResponse { isLive: boolean; played_at?: string }
export interface RecentlyPlayedState { tracks?: RecentPlayItem[]; configured?: boolean; error?: string }
export interface TopGenresState { genres?: TopGenre[]; configured?: boolean; error?: string }
export interface TopTracksState { tracks?: SpotifyTrack[]; configured?: boolean; error?: string }

/* ─── 色彩提取工具：從專輯封面取主色調 ─── */
const extractDominantColor = (imageUrl: string): Promise<RGB> => {
  return new Promise<RGB>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve({ r: 127, g: 90, b: 240 }); return; }
      ctx.drawImage(img, 0, 0, 50, 50);
      const data = ctx.getImageData(0, 0, 50, 50).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        // 過濾太暗或太亮的像素
        if (data[i] + data[i + 1] + data[i + 2] > 60 &&
          data[i] + data[i + 1] + data[i + 2] < 700) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
      }
      if (count > 0) {
        resolve({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      } else {
        resolve({ r: 127, g: 90, b: 240 }); // fallback 紫色
      }
    };
    img.onerror = () => resolve({ r: 127, g: 90, b: 240 });
    // 使用代理避免 CORS
    const apiUrl: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
    img.src = `${apiUrl}/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  });
};

const Music = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('recent');
  const [timeRange, setTimeRange] = useState('medium_term');
  const [dominantColor, setDominantColor] = useState<RGB>({ r: 127, g: 90, b: 240 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 資料改由 TanStack Query 管理：route loader 已 prefetch recently/genres/top-tracks(medium)
  // → SSR baked、hydrate 後 useQuery 讀快取。now-playing 是 30 秒輪詢即時狀態、不進 SSR。
  const { data: recentlyPlayed = null, isPending: recentPending } = useQuery(recentlyPlayedQueryOptions);
  const { data: topGenres = null } = useQuery(topGenresQueryOptions);
  const { data: topTracks = null } = useQuery(topTracksQueryOptions(timeRange));
  const { data: nowPlaying = null } = useQuery(nowPlayingQueryOptions);
  const loading = recentPending;

  // audio-features：依當前分頁的可見曲目 id 抓（Spotify 2024/11 已停用，多半回空）。
  const featureIds =
    activeTab === 'recent'
      ? (recentlyPlayed?.tracks ?? []).map((x) => x.track.id)
      : activeTab === 'yearly'
        ? (topTracks?.tracks ?? []).map((x) => x.id)
        : [];
  const { data: audioFeatures = {} } = useQuery(audioFeaturesQueryOptions(featureIds));

  // now-playing 封面 → 主色調（取代舊 fetchNowPlaying 內的副作用）。
  useEffect(() => {
    const coverUrl = nowPlaying?.item?.album.images[0]?.url;
    if (coverUrl) void extractDominantColor(coverUrl).then(setDominantColor);
  }, [nowPlaying]);


  /* ─── 工具 ─── */
  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMins < 60) return t('common.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('common.hoursAgo', { count: diffHours });
    return date.toLocaleDateString(i18n.resolvedLanguage ?? 'zh-TW', { month: 'short', day: 'numeric' });
  };

  // 以 topTracks 的 metadata 推導聆聽分析（Spotify 2024/11 已停用 audio-features）
  // 統計聚合抽在 lib/trackAnalytics.ts。
  const getTrackAnalytics = () => computeTrackAnalytics(topTracks?.tracks);

  /* ─── Now Playing 資訊 ─── */
  const getNowPlayingData = (): NowPlayingData | null => {
    if (nowPlaying?.is_playing && nowPlaying.item) {
      return { ...nowPlaying, isLive: true };
    }
    // Fallback: 最近播放的第一首
    const recent = recentlyPlayed?.tracks?.[0];
    if (recent) {
      return {
        is_playing: false,
        isLive: false,
        item: recent.track,
        progress_ms: 0,
        played_at: recent.played_at
      };
    }
    return null;
  };

  const glowStyle = {
    '--glow-r': dominantColor.r,
    '--glow-g': dominantColor.g,
    '--glow-b': dominantColor.b,
  } as CSSProperties;

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="music-page" style={glowStyle}>
        <div className="music-dim-overlay" />
        <KoimLoader fullscreen text={t('music.loading')} />
      </div>
    );
  }

  const npData = getNowPlayingData();
  const trackAnalytics = getTrackAnalytics();
  const decadeMax = trackAnalytics?.decades.length ? Math.max(...trackAnalytics.decades.map(d => d.count)) : 1;

  return (
    <div className="music-page" ref={containerRef} style={glowStyle}>
      <div className="music-dim-overlay" />

      {/* ═══ 星雲背景 ═══ */}
      <div className="music-nebula-bg">
        <div className="nebula-layer music-nebula-1" />
        <div className="nebula-layer music-nebula-2" />
        <div className="nebula-layer music-nebula-3" />
      </div>

      <div className="music-content-wrapper">
        {/* ═══ Header ═══ */}
        <motion.div
          className="music-hero"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="music-hero-title">
            <span className="music-title-gradient">{t('music.heroTitle')}</span>
            <span className="music-title-sub">Music Galaxy</span>
          </h1>
          <p className="music-hero-desc">{t('music.heroDesc')}</p>
        </motion.div>

        {/* ═══ Now Playing Hero ═══ */}
        {npData && (
          <motion.section
            className="now-playing-hero"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <div className="np-ambient-glow" />
            <div className="np-content">
              <div className="np-cover-area">
                <img
                  src={npData.item?.album.images.at(0)?.url}
                  alt={npData.item?.name}
                  className="np-cover"
                />
                {/* Audio Visualizer */}
                <div className={`np-visualizer ${npData.isLive ? 'active' : ''}`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    // 固定 5 根等化器條，純裝飾、無資料身分可用，index 是唯一的 key
                    // eslint-disable-next-line @eslint-react/no-array-index-key
                    <div key={i} className="eq-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                  ))}
                </div>
              </div>
              <div className="np-info">
                <div className="np-status-badge">
                  <span className={`np-dot ${npData.isLive ? 'live' : ''}`} />
                  {npData.isLive ? t('music.nowPlaying') : t('music.lastPlayed')}
                </div>
                <h2 className="np-title">{npData.item?.name}</h2>
                <p className="np-artist">{npData.item?.artists.map(a => a.name).join(', ')}</p>
                <p className="np-album">{npData.item?.album.name}</p>
                {npData.isLive && (npData.progress_ms ?? 0) > 0 && npData.item?.duration_ms && (
                  <div className="np-progress-area">
                    <div className="np-progress-bar">
                      <div
                        className="np-progress-fill"
                        style={{ width: `${((npData.progress_ms ?? 0) / npData.item.duration_ms) * 100}%` }}
                      />
                    </div>
                    <div className="np-time">
                      <span>{formatDuration(npData.progress_ms ?? 0)}</span>
                      <span>{formatDuration(npData.item.duration_ms)}</span>
                    </div>
                  </div>
                )}
                {!npData.isLive && npData.played_at && (
                  // 相對時間（formatDate 用 new Date()）server/client 算出來可能差一分鐘 →
                  // hydration text mismatch（React #418）。suppressHydrationWarning：保留 SSR 文字
                  // （SEO 看得到）、client 自行更新、不當成錯配。
                  <p className="np-last-played" suppressHydrationWarning>{formatDate(npData.played_at)}</p>
                )}
                <a
                  href={npData.item?.external_urls.spotify}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="np-spotify-link"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                  {t('music.openInSpotify')}
                </a>
              </div>
            </div>
          </motion.section>
        )}

        {/* ═══ Tabs ═══ */}
        <motion.div
          className="music-tabs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {[
            { id: 'recent', label: t('music.tabs.recent') },
            { id: 'genres', label: t('music.tabs.genres') },
            { id: 'yearly', label: t('music.tabs.yearly') },
            { id: 'analytics', label: t('music.tabs.analytics') },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`music-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  className="tab-active-line"
                  layoutId="musicTab"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </button>
          ))}
        </motion.div>

        {/* ═══ Content ═══ */}
        <div className="music-main-content">
          <AnimatePresence mode="wait">

            {/* ── 最近播放 ── */}
            {activeTab === 'recent' && (
              <motion.div
                key="recent"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.25 }}
                className="music-section"
              >
                <h2 className="section-heading">{t('music.recentHeading')}</h2>
                {recentlyPlayed?.error ? (
                  <div className="music-error-box">
                    <p>{recentlyPlayed.error}</p>
                    {!recentlyPlayed.configured && (
                      <div className="config-hint">
                        <p>如何配置 Spotify API:</p>
                        <ol>
                          <li>前往 <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Spotify Developer Dashboard</a></li>
                          <li>創建應用並獲取 Client ID 和 Client Secret</li>
                          <li>在 server/.env 中設置: <code>SPOTIFY_CLIENT_ID</code>, <code>SPOTIFY_CLIENT_SECRET</code>, <code>SPOTIFY_REFRESH_TOKEN</code></li>
                          <li>重啟後端服務器</li>
                        </ol>
                      </div>
                    )}
                  </div>
                ) : (recentlyPlayed?.tracks?.length ?? 0) > 0 ? (
                  <div className="track-row-list">
                    {/* 列表標題 */}
                    <div className="track-row track-row-header">
                      <span className="tr-num">#</span>
                      <span className="tr-cover-placeholder" />
                      <span className="tr-title-col">{t('music.cols.track')}</span>
                      <span className="tr-features-col">{t('music.cols.features')}</span>
                      <span className="tr-duration-col">{t('music.cols.duration')}</span>
                      <span className="tr-time-col">{t('music.cols.playedAt')}</span>
                    </div>
                    {recentlyPlayed?.tracks?.map((item, index) => {
                      const feat = audioFeatures[item.track.id];
                      return (
                        <motion.a
                          // 同一首歌可能在「最近播放」出現多次 → 光靠 track.id 會重複，必須加 index 才唯一
                          // eslint-disable-next-line @eslint-react/no-array-index-key
                          key={`${item.track.id}-${index}`}
                          href={item.track.external_urls.spotify}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="track-row"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.03 }}
                          whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                        >
                          <span className="tr-num">{index + 1}</span>
                          <img
                            src={item.track.album.images[2]?.url ?? item.track.album.images[0]?.url}
                            alt=""
                            className="tr-cover"
                          />
                          <div className="tr-title-col">
                            <span className="tr-name">{item.track.name}</span>
                            <span className="tr-artist">{item.track.artists.map(a => a.name).join(', ')}</span>
                          </div>
                          <div className="tr-features-col">
                            {feat ? (
                              <>
                                <FeatureBar label={t('music.features.energy')} value={feat.energy} color="var(--feat-energy)" />
                                <FeatureBar label={t('music.features.dance')} value={feat.danceability} color="var(--feat-dance)" />
                                <FeatureBar label={t('music.features.valence')} value={feat.valence} color="var(--feat-valence)" />
                              </>
                            ) : (
                              <span className="tr-no-feat">—</span>
                            )}
                          </div>
                          <span className="tr-duration">{formatDuration(item.track.duration_ms)}</span>
                          <span className="tr-time" suppressHydrationWarning>{formatDate(item.played_at)}</span>
                        </motion.a>
                      );
                    })}
                  </div>
                ) : (
                  <p className="music-no-data">{t('music.empty.recent')}</p>
                )}
              </motion.div>
            )}

            {/* ── 最愛曲風 ── */}
            {activeTab === 'genres' && (
              <motion.div
                key="genres"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.25 }}
                className="music-section"
              >
                <h2 className="section-heading">{t('music.genresHeading')}</h2>
                {topGenres?.error ? (
                  <div className="music-error-box"><p>{topGenres.error}</p></div>
                ) : (topGenres?.genres?.length ?? 0) > 0 ? (
                  <div className="galaxy-bubbles">
                    {(topGenres?.genres ?? []).map((genre, index) => {
                      const maxCount = topGenres?.genres?.[0]?.count ?? 1;
                      const ratio = genre.count / maxCount;
                      const size = 120 + ratio * 80; // 120-200px
                      return (
                        <motion.div
                          key={genre.genre}
                          className="galaxy-bubble"
                          style={{
                            width: size,
                            height: size,
                            animationDelay: `${index * 0.8}s`,
                          }}
                          initial={{ opacity: 0, scale: 0.6 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: index * 0.15, type: 'spring', stiffness: 200 }}
                          whileHover={{ scale: 1.1 }}
                        >
                          <div className="bubble-rank">#{index + 1}</div>
                          <div className="bubble-name">{genre.genre}</div>
                          <div className="bubble-count">{t('music.bubbleCount', { count: genre.count })}</div>
                          <div className="bubble-glow" />
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="music-no-data">{t('music.empty.genres')}</p>
                )}
              </motion.div>
            )}

            {/* ── 年度歌單 ── */}
            {activeTab === 'yearly' && (
              <motion.div
                key="yearly"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.25 }}
                className="music-section"
              >
                <div className="yearly-header-row">
                  <h2 className="section-heading">{t('music.yearlyHeading')}</h2>
                  <div className="time-range-pills">
                    {[
                      { value: 'short_term', label: t('music.range.short') },
                      { value: 'medium_term', label: t('music.range.medium') },
                      { value: 'long_term', label: t('music.range.long') },
                    ].map(r => (
                      <button
                        key={r.value}
                        className={`range-pill ${timeRange === r.value ? 'active' : ''}`}
                        onClick={() => setTimeRange(r.value)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {topTracks?.error ? (
                  <div className="music-error-box"><p>{topTracks.error}</p></div>
                ) : (topTracks?.tracks?.length ?? 0) > 0 ? (
                  <div className="track-row-list">
                    <div className="track-row track-row-header">
                      <span className="tr-num">#</span>
                      <span className="tr-cover-placeholder" />
                      <span className="tr-title-col">{t('music.cols.track')}</span>
                      <span className="tr-features-col">{t('music.cols.features')}</span>
                      <span className="tr-duration-col">{t('music.cols.duration')}</span>
                      <span className="tr-album-col">{t('music.cols.album')}</span>
                    </div>
                    {topTracks?.tracks?.map((track, index) => {
                      const feat = audioFeatures[track.id];
                      return (
                        <motion.a
                          key={track.id}
                          href={track.external_urls.spotify}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="track-row"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.02 }}
                          whileHover={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                        >
                          <span className="tr-num">{index + 1}</span>
                          <img
                            src={track.album.images[2]?.url ?? track.album.images[0]?.url}
                            alt=""
                            className="tr-cover"
                          />
                          <div className="tr-title-col">
                            <span className="tr-name">{track.name}</span>
                            <span className="tr-artist">{track.artists.map(a => a.name).join(', ')}</span>
                          </div>
                          <div className="tr-features-col">
                            {feat ? (
                              <>
                                <FeatureBar label={t('music.features.energy')} value={feat.energy} color="var(--feat-energy)" />
                                <FeatureBar label={t('music.features.dance')} value={feat.danceability} color="var(--feat-dance)" />
                                <FeatureBar label={t('music.features.valence')} value={feat.valence} color="var(--feat-valence)" />
                              </>
                            ) : (
                              <span className="tr-no-feat">—</span>
                            )}
                          </div>
                          <span className="tr-duration">{formatDuration(track.duration_ms)}</span>
                          <span className="tr-album-col tr-album-text">{track.album.name}</span>
                        </motion.a>
                      );
                    })}
                  </div>
                ) : (
                  <p className="music-no-data">{t('music.empty.yearly')}</p>
                )}
              </motion.div>
            )}

            {/* ── 聆聽分析 ── */}
            {activeTab === 'analytics' && (
              <motion.div
                key="analytics"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.25 }}
                className="music-section"
              >
                <h2 className="section-heading">{t('music.analyticsHeading')}</h2>
                <p className="analytics-subtitle">
                  {t('music.analyticsSubtitle', {
                    count: trackAnalytics?.totalTracks ?? 0,
                    range: t(`music.range.${({ short_term: 'short', medium_term: 'medium', long_term: 'long' } as Record<string, string>)[timeRange]}`),
                  })}
                </p>
                {trackAnalytics ? (
                  <>
                    <div className="analytics-dashboard">
                      <AnalyticGauge
                        label={t('music.analytics.popularity')}
                        sublabel="Popularity"
                        value={trackAnalytics.avgPopularity / 100}
                      />
                      <div className="analytic-card analytic-tempo">
                        <div className="analytic-label">{t('music.analytics.avgDuration')}</div>
                        <div className="analytic-sublabel">Avg Duration</div>
                        <div className="tempo-value">
                          <span className="tempo-number">{formatDuration(trackAnalytics.avgDurationMs)}</span>
                        </div>
                      </div>
                      <div className="analytic-card analytic-tempo">
                        <div className="analytic-label">{t('music.analytics.avgRelease')}</div>
                        <div className="analytic-sublabel">Avg Release Year</div>
                        <div className="tempo-value">
                          <span className="tempo-number">{trackAnalytics.avgYear ?? '—'}</span>
                        </div>
                      </div>
                      <div className="analytic-card analytic-tempo">
                        <div className="analytic-label">{t('music.analytics.explicit')}</div>
                        <div className="analytic-sublabel">Explicit</div>
                        <div className="tempo-value">
                          <span className="tempo-number">{Math.round(trackAnalytics.explicitRatio * 100)}</span>
                          <span className="tempo-unit">%</span>
                        </div>
                      </div>
                    </div>

                    {trackAnalytics.decades.length > 0 && (
                      <div className="decade-chart">
                        <h3 className="decade-chart-title">{t('music.analytics.decadeTitle')}</h3>
                        <div className="decade-bars">
                          {trackAnalytics.decades.map(({ decade, count }) => (
                              <div key={decade} className="decade-row">
                                <span className="decade-label">{decade}</span>
                                <div className="decade-bar-track">
                                  <motion.div
                                    className="decade-bar-fill"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(count / decadeMax) * 100}%` }}
                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                  />
                                </div>
                                <span className="decade-count">{count}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="music-no-data">{t('music.empty.analytics')}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

/* ─── 子組件：Audio Feature 進度條 ─── */
const FeatureBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="feat-bar-wrapper">
    <span className="feat-label">{label}</span>
    <div className="feat-bar-track">
      <motion.div
        className="feat-bar-fill"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.round(value * 100)}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
    <span className="feat-value">{Math.round(value * 100)}</span>
  </div>
);

/* ─── 子組件：分析儀表圓環 ─── */
const AnalyticGauge = ({ label, sublabel, value }: { label: string; sublabel: string; value: number }) => {
  const percent = Math.round(value * 100);
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="analytic-card">
      <div className="analytic-label">{label}</div>
      <div className="analytic-sublabel">{sublabel}</div>
      <div className="gauge-ring">
        <svg viewBox="0 0 100 100" className="gauge-svg">
          <circle cx="50" cy="50" r="42" className="gauge-bg" />
          <motion.circle
            cx="50" cy="50" r="42"
            className="gauge-fill"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="gauge-value">{percent}<span className="gauge-percent">%</span></div>
      </div>
    </div>
  );
};

export default Music;
