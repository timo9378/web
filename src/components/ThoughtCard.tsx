import { useState } from 'react';
import { createPortal } from 'react-dom';
import { LocaleLink } from '../locale-link';
import { Heart, ThumbsDown, MessageCircle } from 'lucide-react';
import Comments from './Comments';

/* 單則碎念卡片（feed 與詳情頁共用）。
   - 讚/倒讚：可取消、可切換（localStorage 記 reaction，後端依差值調整）
   - 留言：feed 模式點 icon 跳浮動視窗；detail 模式直接顯示在頁面
   - admin：inline 編輯 + 刪除（ghost 文字鈕） */

const API: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const AUTHOR = 'Koimsurai';

interface ThoughtRef {
  title?: string;
  desc?: string;
  site?: string;
  image?: string;
  url?: string;
  kind?: string;
  year?: string | number;
  overview?: string;
  rating?: string | number;
  genres?: string;
  source?: string;
  poster?: string;
}

export interface Thought {
  id: number;
  content: string;
  created_at: string;
  updated_at?: string;
  edited?: boolean | number;
  likes?: number;
  dislikes?: number;
  comment_count?: number;
  ref_type?: string;
  ref?: ThoughtRef;
  ref_url?: string;
}

interface ThoughtCardProps {
  th: Thought;
  isAdmin?: boolean;
  onDelete?: (id: number) => void;
  onEdit?: (id: number, content: string) => void;
  detail?: boolean;
}

const toDate = (at: string) => new Date(String(at).replace(' ', 'T') + (String(at).includes('Z') ? '' : 'Z'));
const relTime = (at: string): string => {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return at;
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return '剛剛';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小時前`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} 天前`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const WK = ['日', '一', '二', '三', '四', '五', '六'];
const fullCh = (at: string): string => {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日星期${WK[d.getDay()]}`;
};

export default function ThoughtCard({ th, isAdmin, onDelete, onEdit, detail = false }: ThoughtCardProps) {
  const [likes, setLikes] = useState(th.likes ?? 0);
  const [dislikes, setDislikes] = useState(th.dislikes ?? 0);
  const key = 'tk_react_' + th.id;
  const [reacted, setReacted] = useState(() => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(th.content);

  const react = async (kind: string) => {
    const next = reacted === kind ? '' : kind; // 同一顆=取消；不同=切換
    try {
      const r = await fetch(`${API}/thoughts/${th.id}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prev: reacted, next }),
      });
      const d = await r.json().catch(() => ({})) as { likes?: number; dislikes?: number };
      if (typeof d.likes === 'number') setLikes(d.likes);
      if (typeof d.dislikes === 'number') setDislikes(d.dislikes);
      localStorage.setItem(key, next);
      setReacted(next);
    } catch { /* ignore */ }
  };

  const saveEdit = () => {
    if (editText.trim() && onEdit) onEdit(th.id, editText.trim());
    setEditing(false);
  };

  return (
    <div className="tk-card">
      <div className="tk-card-head">
        <span className="tk-author">{AUTHOR}</span>
        <time className="tk-time" dateTime={th.created_at}>{relTime(th.created_at)}</time>
        {th.edited && th.updated_at && (
          <span className="tk-edited" data-edited={`編輯於 ${fullCh(th.updated_at)}`}>（已編輯）</span>
        )}
      </div>

      {editing ? (
        <div className="tk-edit">
          <textarea className="tk-edit-text" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
          <div className="tk-edit-row">
            <button className="tk-edit-save" onClick={saveEdit}>儲存</button>
            <button className="tk-edit-cancel" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <p className="tk-text">{th.content}</p>
      )}

      {th.ref_type === 'link' && th.ref && (
        <a className="tk-embed tk-embed--link tk-linkcard" href={th.ref_url} target="_blank" rel="noopener noreferrer">
          <div className="tk-embed-info">
            <h3 className="tk-embed-title">{th.ref.title ?? th.ref_url}</h3>
            {th.ref.desc && <p className="tk-embed-desc">{th.ref.desc}</p>}
            <span className="tk-embed-meta"><span className="tk-embed-site">🌐 {th.ref.site}</span></span>
          </div>
          {th.ref.image && <img className="tk-linkcard-img" src={th.ref.image} alt="" loading="lazy" />}
        </a>
      )}

      {th.ref_type === 'media' && th.ref && (
        <a className="tk-embed tk-embed--media tk-media" href={th.ref.url ?? th.ref_url} target="_blank" rel="noopener noreferrer">
          <div className="tk-embed-info">
            <span className="tk-embed-kind">{th.ref.kind} · {th.ref.year}</span>
            <h3 className="tk-embed-title">{th.ref.title}</h3>
            {th.ref.overview && <p className="tk-embed-desc">{th.ref.overview}</p>}
            <span className="tk-embed-meta">★ {th.ref.rating} · {th.ref.genres} · {th.ref.source}</span>
          </div>
          {th.ref.poster && <img className="tk-media-poster" src={th.ref.poster} alt={th.ref.title} loading="lazy" />}
        </a>
      )}

      <div className="tk-divider" />

      <div className="tk-card-foot">
        <div className="tk-stats">
          <button className={'tk-ic' + (reacted === 'like' ? ' is-like' : '')} onClick={() => { void react('like'); }} aria-label="讚">
            <Heart size={16} /> <span>{likes}</span>
          </button>
          <button className={'tk-ic' + (reacted === 'dislike' ? ' is-dislike' : '')} onClick={() => { void react('dislike'); }} aria-label="倒讚">
            <ThumbsDown size={16} /> <span>{dislikes}</span>
          </button>
          {detail ? (
            <span className="tk-ic tk-ic--static"><MessageCircle size={16} /> <span>{th.comment_count ?? 0}</span></span>
          ) : (
            <button className="tk-ic" onClick={() => setShowComments(true)} aria-label="留言">
              <MessageCircle size={16} /> <span>{th.comment_count ?? 0}</span>
            </button>
          )}
        </div>
        <div className="tk-foot-actions">
          {isAdmin && (
            <button className="tk-act" onClick={() => { setEditText(th.content); setEditing(true); }}>編輯</button>
          )}
          {isAdmin && <button className="tk-act tk-act--del" onClick={() => onDelete?.(th.id)}>刪除</button>}
          {!detail && <LocaleLink className="tk-view" to={`/thinking/${th.id}`}>查看 →</LocaleLink>}
        </div>
      </div>

      {showComments && createPortal(
        // 用 e.target === e.currentTarget 判斷「點在遮罩本身」，而不是靠內層 div
        // stopPropagation 擋冒泡：後者等於在一個非互動元素上掛 onClick，只為了
        // 攔事件。改掉之後內層那層純事件管線的 onClick 可以整個拿掉。
        <div className="tk-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowComments(false); }}>
          <div className="tk-modal">
            <div className="tk-modal-head">
              <span>評論</span>
              <button className="tk-modal-close" onClick={() => setShowComments(false)} aria-label="關閉">✕</button>
            </div>
            <div className="tk-modal-body">
              <Comments postId={th.id} basePath="thoughts" />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
