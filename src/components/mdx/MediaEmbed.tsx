// MDX 影片 block。
//   <Video src="/uploads/demo.mp4" poster="…" caption="…" />：自架影片，原生 <video> player。
//   <YouTube id="dQw4w9WgXcQ" title="…" />：facade——先只放縮圖 + 播放鈕，點了才載 iframe
//     （youtube-nocookie，減少追蹤；未點擊前不連 YouTube，對嚴格 CSP 友善）。
import { useState } from 'react';
import VideoPlayer from './VideoPlayer';

// width/height 從 MDX 屬性進來是字串；轉成正數才給 VideoPlayer 當 <video> 的尺寸屬性
// （用於預留佔位比例、防 CLS）。缺或非法就不帶，VideoPlayer 退回無預留的舊行為。
function toDim(v: string | number | undefined): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function Video(
  { src, poster, caption, width, height }:
  { src?: string; poster?: string; caption?: string; width?: string | number; height?: string | number },
) {
  if (!src) return null;
  return <VideoPlayer src={src} poster={poster} caption={caption} width={toDim(width)} height={toDim(height)} />;
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
          // ⚠ 縮圖一定要走 `img.youtube.com`，不是 `i.ytimg.com`。兩個 host 回的是**同一張圖**
          //   （實測都是 21011 bytes），但站上的 CSP `img-src` 只允許前者——用 i.ytimg.com 的話
          //   縮圖會被擋掉，facade 變成一個空白按鈕，而且畫面上完全看不出原因。
          style={{ backgroundImage: `url(https://img.youtube.com/vi/${id}/hqdefault.jpg)` }}
        >
          <span className="mdx-youtube-play" aria-hidden>▶</span>
        </button>
      )}
    </div>
  );
}
