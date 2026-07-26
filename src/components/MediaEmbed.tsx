// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useRef, useState } from 'react';

export function Video({ src, poster, caption }: { src?: string; poster?: string; caption?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // 自己畫一顆置中的播放鍵，不依賴原生控制列的位置：
  // 原生控制列在 shadow DOM 裡、只佔底部一條，直式影片或版面一變就容易變得難按（或根本看不到）。
  // 這顆按鈕跟站上圖片燈箱一樣是實體元素，hover / 點擊行為明確；播放後就隱藏，不擋控制列。
  const start = () => {
    const el = ref.current;
    if (!el) return;
    void el.play().catch(() => { /* 自動播放政策擋下時忽略；使用者仍可用原生控制列 */ });
  };

  if (!src) return null;
  return (
    <figure className="mdx-video">
      <div className="mdx-video-frame">
        <video
          ref={ref}
          className="mdx-video-el"
          controls
          playsInline
          preload="metadata"
          poster={poster}
          src={src}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {!playing && (
          <button type="button" className="mdx-video-play" onClick={start} aria-label="播放影片">
            <span aria-hidden>▶</span>
          </button>
        )}
      </div>
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
