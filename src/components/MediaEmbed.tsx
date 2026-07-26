// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useState } from 'react';

export function Video({ src, poster, caption }: { src?: string; poster?: string; caption?: string }) {
  if (!src) return null;
  // 點影片「畫面」就播放/暫停（<video controls> 預設點畫面不會播，只有控制列會）。
  // ⚠ 控制列在 shadow DOM 裡，點它產生的 click 會 retarget 成 video 本身 → 這個 handler
  // 也會收到。若不排除，會變成「原生開始播放 → 這裡立刻 pause()」互相抵銷＝點按鈕沒反應。
  // 所以底部控制列那一條（約 44px）直接交給瀏覽器處理。
  const CONTROLS_BAND = 44;
  const toggle = (e: React.MouseEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (e.clientY > rect.bottom - CONTROLS_BAND) return; // 控制列區：不插手
    if (el.paused) void el.play().catch(() => { /* 非使用者手勢的失敗忽略 */ });
    else el.pause();
  };
  return (
    <figure className="mdx-video">
      <video
        className="mdx-video-el"
        controls
        playsInline
        preload="metadata"
        poster={poster}
        src={src}
        onClick={toggle}
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function YouTube({ id, title = 'YouTube 影片' }: { id?: string; title?: string }) {
  const [play, setPlay] = useState(false);
  if (!id) return null;
  return (
    <div className="mdx-youtube">
      {play ? (
        <iframe
          className="mdx-youtube-frame"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          className="mdx-youtube-facade"
          onClick={() => setPlay(true)}
          aria-label={`播放：${title}`}
          style={{ backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` }}
        >
          <span className="mdx-youtube-play" aria-hidden>▶</span>
        </button>
      )}
    </div>
  );
}
