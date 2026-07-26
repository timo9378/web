// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useState } from 'react';
import VideoPlayer from './VideoPlayer';

export function Video({ src, poster, caption }: { src?: string; poster?: string; caption?: string }) {
  if (!src) return null;
  return <VideoPlayer src={src} poster={poster} caption={caption} />;
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
