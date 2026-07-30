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

export default function VideoPlayer(
  { src, poster, caption, width, height }:
  { src: string; poster?: string; caption?: string; width?: number; height?: number },
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [diag, setDiag] = useState('');

  // ?debug=video → 播放 2 秒後掃一次，把祖先鏈的合成觸發屬性與覆蓋元素印出來（見 lib/videoDiag）
  useEffect(() => {
    if (typeof location === 'undefined' || !location.search.includes('debug=video')) return;
    const t = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      void import('../lib/videoDiag').then(({ diagnoseVideo }) => {
        const report = diagnoseVideo(v);
        setDiag(report);
        console.log(report);
      });
    }, 2000);
    return () => clearTimeout(t);
  }, []);

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

  // metadata 可能在 hydrate 前就 load 完 → onLoadedMetadata 永遠不會進 React，總時長會卡在 0:00。
  // mount 時主動補讀一次，並持續監聽 durationchange（部分 mp4 一開始回 Infinity，seek 後才定案）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // <video> 的 muted/paused/currentTime 是 DOM 元素自己的狀態，render 期讀不到
    // （元素還沒掛上），只能在 effect 裡同步一次再訂閱事件。set-state-in-effect 無解。
    /* eslint-disable @eslint-react/set-state-in-effect */
    const sync = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
      setMuted(v.muted);
      setPlaying(!v.paused);
      setTime(v.currentTime);
    };
    /* eslint-enable @eslint-react/set-state-in-effect */
    sync();
    v.addEventListener('durationchange', sync);
    v.addEventListener('loadedmetadata', sync);
    return () => {
      v.removeEventListener('durationchange', sync);
      v.removeEventListener('loadedmetadata', sync);
    };
  }, []);

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

  // 有尺寸時：把 aspect-ratio 放在容器 .vp 上（不是 <video>），容器就有確定的佔位比例，
  // metadata 載入前後高度一致 → 消除 reload + scroll-restoration 的 CLS。<video> 用
  // object-fit:contain 填滿容器。豎屏受 max-height 限、橫屏受 max-width 限，兩者都保持比例。
  // 全螢幕時不套（改由 .vp--fullscreen 佔滿視窗）。
  const sized = !fullscreen && !!width && !!height;

  return (
    <figure className="mdx-video">
      <div
        ref={wrapRef}
        className={fullscreen ? 'vp vp--fullscreen' : sized ? 'vp vp--sized' : 'vp'}
        style={sized ? { aspectRatio: `${width} / ${height}` } : undefined}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* 站上的影片是無語音的畫面錄製（操作示範），沒有可字幕化的內容；
            真的加語音旁白時要補 <track kind="captions"> */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className="vp-video"
          playsInline
          preload="auto"
          poster={poster}
          src={src}
          // width/height 屬性讓瀏覽器在 metadata 載入前就從比例預留空間（同 <img> 防 CLS 的機制）。
          // 沒有它時 <video> 首屏是預設 150px，metadata 一到就撐成真實高度 → reload + scroll
          // restoration 時這段高度差會把下方內容整段推移，是文章頁 CLS 的主因（實測影片撐高 424px）。
          // CSS 的 max-height/max-width 仍照常約束顯示尺寸，只是佔位比例正確。
          width={width}
          height={height}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
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
            // 自訂進度條，ARIA 是完整的（valuemin/valuemax/valuenow + tabIndex + onKeyDown）。
            // <input type="range"> 語意雖對，但自訂軌道/滑塊的外觀要整套重刻，換不划算
            // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
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
      {diag ? (
        <>
          <button
            type="button"
            className="vp-diag-btn"
            onClick={() => { void import('../lib/videoDiag').then(({ bisectVideo }) => bisectVideo(src)); }}
          >
            開對照組（8 個版本並排，截圖給我）
          </button>
          <pre className="vp-diag">{diag}</pre>
        </>
      ) : null}
    </figure>
  );
}
