/* 自訂影片播放器（取代原生 controls）。
 *
 * 為什麼不用原生 controls：它活在 shadow DOM 裡——樣式改不動、事件會 retarget（自訂點擊
 * 邏輯會跟它打架）、位置也綁死在底部一條；直式影片或窄欄下常常難按甚至看不到。
 * 全部自己畫之後，行為與外觀都可控，也跟站上的玻璃質感一致。
 *
 * 控制列：播放/暫停 · 進度條（可點可拖）· 時間 · 音量 · 下載 · 全螢幕。
 * 播放中滑鼠離開會自動淡出，hover / 暫停時浮出。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaPlay, FaPause, FaVolumeHigh, FaVolumeXmark, FaDownload, FaExpand, FaCompress } from 'react-icons/fa6';
import './VideoPlayer.css';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function VideoPlayer({ src, poster, caption }: { src: string; poster?: string; caption?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => { /* 自動播放政策擋下時忽略 */ });
    else v.pause();
  }, []);

  const seekTo = useCallback((clientX: number, bar: HTMLElement) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const r = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = ratio * v.duration;
    setTime(v.currentTime);
  }, []);

  // 拖曳進度條：pointer 事件掛到 window，滑出控制列也能繼續拖
  useEffect(() => {
    if (!scrubbing) return;
    const bar = wrapRef.current?.querySelector<HTMLElement>('.vp-progress');
    const move = (e: PointerEvent) => { if (bar) seekTo(e.clientX, bar); };
    const up = () => setScrubbing(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [scrubbing, seekTo]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => { /* 忽略 */ });
    else void el.requestFullscreen().catch(() => { /* 忽略 */ });
  }, []);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const showBar = !playing || hovering || scrubbing;

  return (
    <figure className="mdx-video">
      <div
        ref={wrapRef}
        className={fullscreen ? 'vp vp--fullscreen' : 'vp'}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <video
          ref={videoRef}
          className="vp-video"
          playsInline
          preload="auto"
          poster={poster}
          src={src}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        />

        {/* 未播放時的大播放鍵（播放後隱藏） */}
        {!playing && (
          <button type="button" className="vp-bigplay" onClick={toggle} aria-label="播放影片">
            <FaPlay aria-hidden />
          </button>
        )}

        <div className={showBar ? 'vp-bar vp-bar--show' : 'vp-bar'}>
          <button type="button" className="vp-btn" onClick={toggle} aria-label={playing ? '暫停' : '播放'}>
            {playing ? <FaPause aria-hidden /> : <FaPlay aria-hidden />}
          </button>

          <div
            className="vp-progress"
            role="slider"
            tabIndex={0}
            aria-label="播放進度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            onPointerDown={(e) => { setScrubbing(true); seekTo(e.clientX, e.currentTarget); }}
            onKeyDown={(e) => {
              const v = videoRef.current;
              if (!v) return;
              if (e.key === 'ArrowRight') { v.currentTime = Math.min(v.duration, v.currentTime + 5); e.preventDefault(); }
              if (e.key === 'ArrowLeft') { v.currentTime = Math.max(0, v.currentTime - 5); e.preventDefault(); }
              if (e.key === ' ' || e.key === 'Enter') { toggle(); e.preventDefault(); }
            }}
          >
            <div className="vp-progress-track" />
            <div className="vp-progress-fill" style={{ width: `${pct}%` }} />
            <div className="vp-progress-knob" style={{ left: `${pct}%` }} />
          </div>

          <span className="vp-time">{fmt(time)} / {fmt(duration)}</span>

          <button
            type="button"
            className="vp-btn"
            onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted; }}
            aria-label={muted ? '取消靜音' : '靜音'}
          >
            {muted ? <FaVolumeXmark aria-hidden /> : <FaVolumeHigh aria-hidden />}
          </button>

          <a className="vp-btn" href={src} download aria-label="下載影片">
            <FaDownload aria-hidden />
          </a>

          <button type="button" className="vp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? '離開全螢幕' : '全螢幕'}>
            {fullscreen ? <FaCompress aria-hidden /> : <FaExpand aria-hidden />}
          </button>
        </div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
