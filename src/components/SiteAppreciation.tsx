/* 首頁收尾的兩顆小按鈕：對「整個站」按個讚，以及去 GitHub 給專案一顆星。
   - 按讚只存聚合數（site_counters），防重複在 client 以 localStorage 做，不收 IP。
   - GitHub 星數走自家後端代理 + 快取，讀者的瀏覽器不會直接打 api.github.com。
   - 兩者都在掛載後才抓數字：SSR 與首次 client render 一致，不會 hydration mismatch。 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaGithub, FaHeart } from 'react-icons/fa6';
import { apiUrl } from '../api';
import './SiteAppreciation.css';

const LIKED_KEY = 'site:liked';
const REPO_URL = 'https://github.com/timo9378/sora-to-ki';

export default function SiteAppreciation() {
  const { t } = useTranslation();
  const [likes, setLikes] = useState<number | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    let already = false;
    try { already = localStorage.getItem(LIKED_KEY) === '1'; } catch { /* 不可用就當沒按過 */ }
    const apply = (n: number | null) => {
      if (ac.signal.aborted) return;
      if (n !== null) setLikes(n);
      if (already) setLiked(true);
    };
    fetch(apiUrl('/api/site/likes'), { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((d) => apply(d ? d.count : null))
      .catch(() => apply(null));
    fetch(apiUrl('/api/site/github-stars'), { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((d) => { if (!ac.signal.aborted && d) setStars(d.count); })
      .catch(() => { /* 靜默：星數抓不到就不顯示數字 */ });
    return () => ac.abort();
  }, []);

  const like = useCallback(() => {
    if (liked || busy) return;
    setBusy(true);
    fetch(apiUrl('/api/site/likes'), { method: 'POST' })
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((d) => {
        if (d) setLikes(d.count);
        setLiked(true);
        try { localStorage.setItem(LIKED_KEY, '1'); } catch { /* 忽略 */ }
      })
      .catch(() => { /* 失敗就維持未按狀態，可再試 */ })
      .finally(() => setBusy(false));
  }, [liked, busy]);

  return (
    <div className="site-appreciation">
      <button
        type="button"
        className={liked ? 'site-appr-item site-appr-item--liked' : 'site-appr-item'}
        onClick={like}
        disabled={liked || busy}
        aria-label={t('home.appreciation.likeAria')}
      >
        <FaHeart className="site-appr-icon" aria-hidden />
        <span className="site-appr-label">{t('home.appreciation.like')}</span>
        {likes !== null && <span className="site-appr-count">{likes}</span>}
      </button>

      <span className="site-appr-sep" aria-hidden />

      <a className="site-appr-item" href={REPO_URL} target="_blank" rel="noreferrer noopener">
        <FaGithub className="site-appr-icon" aria-hidden />
        <span className="site-appr-label">{t('home.appreciation.star')}</span>
        {stars !== null && <span className="site-appr-count">{stars}</span>}
      </a>
    </div>
  );
}
