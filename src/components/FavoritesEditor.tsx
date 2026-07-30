// /watch 一生推 admin 編輯浮窗：TMDb 搜尋選片 → 設星等 + 短評 → 存。
// 標題/海報/年份由後端依語系即時帶，這裡只管策展資料（rating/quote/排序/增刪）。
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth';
import type { TmdbSearchResponse, TmdbSearchResult, WatchFavoriteRow } from '@koimsurai/api-types';
import './FavoritesEditor.css';

const API: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

// 與 Watch 共用同一份生成型別（backend handlers::watch::WatchFavoriteRow）——
// 這裡原本另外手寫一份，欄位可選性跟 Watch 那份還互相打架（poster?: string
// vs string | null），型別上是兩個各自為政的猜測。
type Favorite = WatchFavoriteRow;

// 同樣改吃生成型別（backend handlers::watch::TmdbSearchResult）。手寫版把 tmdbId/title
// 標成必有——後端那兩個欄位都是從 TMDb 回應撈出來的，撈不到就是 null。
type SearchResult = TmdbSearchResult;

interface StarPickerProps {
  value: number;
  onChange: (n: number) => void;
}

function StarPicker({ value, onChange }: StarPickerProps) {
  return (
    <span className="fe-stars" role="radiogroup" aria-label="rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={'fe-star ' + (n <= value ? 'on' : '')}
          onClick={() => onChange(n)}
          aria-label={`${n}`}
        >★</button>
      ))}
    </span>
  );
}

interface FavoritesEditorProps {
  favorites: Favorite[];
  onClose: () => void;
  onChanged: () => void;
}

export default function FavoritesEditor({ favorites, onClose, onChanged }: FavoritesEditorProps) {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);

  // 新增區：TMDb 搜尋
  const [kind, setKind] = useState('film');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken() ?? ''}`,
  }), [getToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // 搜尋輸入 debounce 400ms → debouncedQuery
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(id);
  }, [query]);

  // TMDb 搜尋改由 TanStack Query（debouncedQuery + kind 進 queryKey；空字串不抓）。
  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ['watch', 'tmdb-search', debouncedQuery, kind],
    queryFn: async (): Promise<SearchResult[]> => {
      const r = await fetch(
        `${API}/watch/tmdb-search?q=${encodeURIComponent(debouncedQuery)}&kind=${kind === 'film' ? 'movie' : 'tv'}`,
        { headers: authHeaders() },
      ).then((x) => x.json()) as TmdbSearchResponse;
      return r.results;
    },
    enabled: !!debouncedQuery,
    staleTime: 60 * 1000,
  });

  const addFavorite = async (item: SearchResult) => {
    setBusy(true);
    try {
      await fetch(`${API}/watch/favorites`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ tmdbId: item.tmdbId, kind, rating: 5, quote: '' }),
      });
      setQuery(''); setDebouncedQuery('');
      onChanged();
    } finally { setBusy(false); }
  };

  const patchFavorite = async (id: number, patch: Record<string, unknown>) => {
    await fetch(`${API}/watch/favorites/${id}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(patch),
    });
    onChanged();
  };

  const removeFavorite = async (id: number) => {
    setBusy(true);
    try {
      await fetch(`${API}/watch/favorites/${id}`, { method: 'DELETE', headers: authHeaders() });
      onChanged();
    } finally { setBusy(false); }
  };

  // 移動排序：跟相鄰項互換 sort_order
  const move = async (idx: number, dir: number) => {
    // 明確檢查邊界，不用 favorites.at()：at(-1) 會回傳「最後一個元素」而不是 undefined，
    // idx=0 往上移時就會跟清單尾端互換 —— 那是 bug 不是防護。
    const j = idx + dir;
    if (idx < 0 || idx >= favorites.length || j < 0 || j >= favorites.length) return;
    const a = favorites[idx], b = favorites[j];
    setBusy(true);
    try {
      await Promise.all([
        patchFavorite(a.id, { sort_order: idx + dir }),
        patchFavorite(b.id, { sort_order: idx }),
      ]);
    } finally { setBusy(false); }
  };

  return createPortal(
    // 用 e.target === e.currentTarget 判斷「點在遮罩本身」，而不是靠內層 div
    // stopPropagation 擋冒泡：後者等於在一個非互動元素上掛 onClick，只為了
    // 攔事件。改掉之後內層那層純事件管線的 onClick 可以整個拿掉。
    // 同上：本元件有 Escape 監聽與右上關閉鈕，遮罩點擊只是滑鼠便利
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
    <div className="fe-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fe-modal">
        <div className="fe-head">
          <h3>{t('watch.favManage')}</h3>
          <button className="fe-close" onClick={onClose} aria-label="close">✕</button>
        </div>

        {/* 現有清單 */}
        <div className="fe-list">
          {favorites.length === 0 && <p className="fe-empty">{t('watch.favEmpty')}</p>}
          {favorites.map((f, i) => (
            <div className="fe-item" key={f.id}>
              {f.poster
                ? <img className="fe-item-poster" src={f.poster} alt={f.title} loading="lazy" />
                : <span className="fe-item-poster fe-item-poster--blank">{f.title.slice(0, 2)}</span>}
              <div className="fe-item-body">
                <div className="fe-item-top">
                  <span className="fe-item-title">{f.title}{f.year ? ` · ${f.year}` : ''}</span>
                  <span className="fe-item-actions">
                    <button disabled={i === 0 || busy} onClick={() => { void move(i, -1); }} aria-label="up">↑</button>
                    <button disabled={i === favorites.length - 1 || busy} onClick={() => { void move(i, 1); }} aria-label="down">↓</button>
                    <button className="fe-del" disabled={busy} onClick={() => { void removeFavorite(f.id); }} aria-label="delete">🗑</button>
                  </span>
                </div>
                {/* rating / quote 在 DB 都允許 NULL（rating INTEGER DEFAULT 5、quote TEXT DEFAULT ''，
                    兩者都沒有 NOT NULL）——舊資料可能是 NULL，這裡補上顯示用的預設。 */}
                <StarPicker value={f.rating ?? 0} onChange={(n) => { void patchFavorite(f.id, { rating: n }); }} />
                <textarea
                  className="fe-quote"
                  defaultValue={f.quote ?? ''}
                  placeholder={t('watch.favQuotePlaceholder')}
                  onBlur={(e) => { if (e.target.value !== f.quote) void patchFavorite(f.id, { quote: e.target.value }); }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 新增區 */}
        <div className="fe-add">
          <div className="fe-add-row">
            <div className="fe-kind">
              <button className={kind === 'film' ? 'on' : ''} onClick={() => setKind('film')}>{t('watch.kindFilm')}</button>
              <button className={kind === 'tv' ? 'on' : ''} onClick={() => setKind('tv')}>{t('watch.kindTv')}</button>
            </div>
            <input
              className="fe-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('watch.favSearchPlaceholder')}
            />
          </div>
          {searching && <p className="fe-searching">{t('watch.favSearching')}</p>}
          {results.length > 0 && (
            <ul className="fe-results">
              {results.map((r) => (
                <li key={r.tmdbId}>
                  <button className="fe-result" disabled={busy} onClick={() => { void addFavorite(r); }}>
                    {/* alt 用 `?? ''`：沒標題時海報右邊那行標題也是空的，硬掛假替代文字更糟 */}
                    {r.poster
                      ? <img src={r.poster} alt={r.title ?? ''} loading="lazy" />
                      : <span className="fe-result-blank">—</span>}
                    <span className="fe-result-meta">
                      <span className="fe-result-title">{r.title}</span>
                      <span className="fe-result-year">{r.year ?? ''}</span>
                    </span>
                    <span className="fe-result-add">＋</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
