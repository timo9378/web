// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useState } from 'react';

export function Video({ src, poster, caption }: { src?: string; poster?: string; caption?: string }) {
  if (!src) return null;
  // 點影片畫面就播放/暫停：<video controls> 預設「點畫面」不會播，只有控制列的按鈕會，
  // 直式影片被拉很高時那顆按鈕常常在畫面外 → 讀者會以為影片壞了。
  const toggle = (e: React.MouseEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    if (el.paused) void el.play().catch(() => { /* 使用者手勢以外的失敗忽略 */ });
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
