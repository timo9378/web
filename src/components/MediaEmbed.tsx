// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useRef, useState } from 'react';

export function Video({ src, poster, caption }: { src?: string; poster?: string; caption?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // started：是否已經開始播過。未開始 → 只顯示自訂的大播放鍵（原生控制列先不出，
  // 免得畫面上同時有兩顆播放鍵）；開始之後 → 交給原生控制列，並支援點畫面 toggle。
  const [started, setStarted] = useState(false);

  const play = () => {
    const el = ref.current;
    if (!el) return;
    void el.play().catch(() => { /* 自動播放政策擋下時忽略 */ });
  };

  // 點影片「畫面」播放/暫停。⚠ 原生控制列在 shadow DOM，點它的 click 會 retarget 成 video
  // 本身 → 不排除的話會跟原生行為抵銷（按鈕看起來沒反應）。底部那條交給瀏覽器。
  const CONTROLS_BAND = 44;
  const toggleByPicture = (e: React.MouseEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    if (!started) return; // 尚未開始：由上面那顆大按鈕負責
    if (e.clientY > el.getBoundingClientRect().bottom - CONTROLS_BAND) return;
    if (el.paused) void el.play().catch(() => { /* 忽略 */ });
    else el.pause();
  };

  if (!src) return null;
  return (
    <figure className="mdx-video">
      <div className="mdx-video-frame">
        <video
          ref={ref}
          className="mdx-video-el"
          controls={started}
          playsInline
          preload="auto"
          poster={poster}
          src={src}
          onPlay={() => setStarted(true)}
          onClick={toggleByPicture}
        />
        {!started && (
          <button type="button" className="mdx-video-play" onClick={play} aria-label="播放影片">
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
