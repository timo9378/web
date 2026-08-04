import { useEffect, useRef, useState } from 'react';
import './IntroAnimation.css';

const STAR_COUNT = 700;
const IMMEDIATE_STAR_COUNT = 240;
const MAX_R_FACTOR = 0.75;
const FADE_IN_PX = 90;
const FADE_OUT_FACTOR = 0.85;
const STAGGER_SPAWN_WINDOW = 1200;
const SPEED_MIN = 80;
const SPEED_MAX = 1100;

const TIMINGS = {
  rampEnd: 400,
  peakEnd: 1900,
  decelEnd: 2900,
  flashCss: 2200,
  // Fire pre-reveal during stable hyperspace so Layout's heavy initial
  // React render finishes well before flash starts (2200ms). Avoids
  // any reconciliation cost coinciding with the Saturn reveal moment.
  preReveal: 1800,
  explosion: 2900,
  endStart: 3200,
  unmount: 3500,
};

interface Star {
  angle: number;
  r: number;
  baseSpeed: number;
  streakLen: number;
  seed: number;
  baseAlpha: number;
  spawnDelay: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const getSpeedMult = (elapsed: number) => {
  if (elapsed < TIMINGS.rampEnd) {
    const t = elapsed / TIMINGS.rampEnd;
    // Start from 0 (fully still) — gives a real "we're entering hyperspace"
    // sensation rather than dropping the user straight into peak speed.
    return Math.pow(t, 1.4);
  }
  if (elapsed < TIMINGS.peakEnd) {
    return 1;
  }
  if (elapsed < TIMINGS.decelEnd) {
    const t =
      (elapsed - TIMINGS.peakEnd) / (TIMINGS.decelEnd - TIMINGS.peakEnd);
    return 1 - easeOutCubic(t);
  }
  return 0;
};

const spawnStar = (): Star => {
  // Wide speed range (≈14×) gives a natural depth illusion: slow stars
  // act as the "very distant" layer that used to be the static bg, but
  // they still stream — physically consistent with being inside a tunnel.
  const baseSpeed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
  return {
    angle: Math.random() * Math.PI * 2,
    r: 0,
    baseSpeed,
    streakLen: 25 + baseSpeed * 0.5,
    seed: Math.random(),
    baseAlpha: 0.4 + Math.random() * 0.55,
    spawnDelay: 0,
  };
};

interface IntroAnimationProps {
  onAnimationComplete?: () => void;
  onExplosionStart?: () => void;
  onPreReveal?: () => void;
}

const IntroAnimation = ({
  onAnimationComplete,
  onExplosionStart,
  onPreReveal,
}: IntroAnimationProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ending, setEnding] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const callbacksRef = useRef({
    onAnimationComplete,
    onExplosionStart,
    onPreReveal,
  });
  callbacksRef.current = {
    onAnimationComplete,
    onExplosionStart,
    onPreReveal,
  };

  useEffect(() => {
    document.body.classList.add('intro-animation-active');
    return () => { document.body.classList.remove('intro-animation-active'); };
  }, []);

  // Remove the body class the moment the container starts fading out so
  // the nebula dim overlay can cross-fade in alongside, not appear after
  // the intro is fully gone.
  useEffect(() => {
    if (ending) {
      document.body.classList.remove('intro-animation-active');
    }
  }, [ending]);

  useEffect(() => {
    // matchMedia 全瀏覽器都有，原本的 ?. 是死碼；typeof window 那道是 SSR 守衛，不同回事，保留。
    // 寫成三元式而非 `typeof window !== 'undefined' && window.matchMedia(…)`：後者會被
    // prefer-optional-chain 要求改成 window?.matchMedia(…)，但 SSR 下 window 這個識別字
    // 根本沒宣告，optional chain 一樣 ReferenceError（同 src/lib/api.ts 對 process 的註記）。
    const prefersReducedMotion =
      typeof window === 'undefined'
        ? false
        : window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const timers: ReturnType<typeof setTimeout>[] = [];
    // 統一走 later()：排程與登記綁在一起，不會有漏 push 的路徑
    // （也讓 web-api-no-leaked-timeout 看得到 setTimeout 的回傳有被接住）。
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
    };
    const clearTimers = () => { timers.forEach((id) => { clearTimeout(id); }); };
    let raf = 0;
    let explosionFired = false;
    let completeFired = false;
    let preRevealFired = false;

    const fireExplosion = () => {
      if (explosionFired) return;
      explosionFired = true;
      callbacksRef.current.onExplosionStart?.();
    };
    const firePreReveal = () => {
      if (preRevealFired) return;
      preRevealFired = true;
      callbacksRef.current.onPreReveal?.();
    };
    const fireComplete = () => {
      if (completeFired) return;
      completeFired = true;
      callbacksRef.current.onAnimationComplete?.();
    };

    if (skipped || prefersReducedMotion) {
      firePreReveal();
      fireExplosion();
      later(() => {
        setEnding(true);
        fireComplete();
      }, 80);
      later(() => setDone(true), 380);
      return clearTimers;
    }

    later(firePreReveal, TIMINGS.preReveal);
    later(fireExplosion, TIMINGS.explosion);
    later(() => {
      setEnding(true);
      fireComplete();
    }, TIMINGS.endStart);
    later(() => setDone(true), TIMINGS.unmount);

    const canvas = canvasRef.current;
    if (!canvas) {
      return clearTimers;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return clearTimers;
    }

    let width = window.innerWidth;
    let height = window.innerHeight;
    let maxR = Math.hypot(width, height) * MAX_R_FACTOR;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      maxR = Math.hypot(width, height) * MAX_R_FACTOR;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Two-tier initial population:
    //   IMMEDIATE_STAR_COUNT pre-positioned at varied r — gives frame 1
    //   some context so the first 200 ms isn't black,
    //   the rest start at r=0 with a staggered spawnDelay so the tunnel
    //   visibly "fills in" over the first second instead of appearing
    //   fully formed.
    const stars = Array.from({ length: STAR_COUNT }, (_, i) => {
      const s = spawnStar();
      if (i < IMMEDIATE_STAR_COUNT) {
        s.r = 60 + Math.random() * (maxR * 0.7 - 60);
        s.spawnDelay = 0;
      } else {
        s.r = 0;
        s.spawnDelay = Math.random() * STAGGER_SPAWN_WINDOW;
      }
      return s;
    });

    const startTime = performance.now();
    let lastFrame = startTime;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const dt = Math.min(now - lastFrame, 33);
      lastFrame = now;

      if (elapsed >= TIMINGS.explosion) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, width, height);
        return;
      }

      const speedMult = getSpeedMult(elapsed);

      const bgAlpha = elapsed > TIMINGS.peakEnd ? 0.28 : 0.12;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(2, 3, 12, ${bgAlpha})`;
      ctx.fillRect(0, 0, width, height);

      ctx.lineCap = 'round';

      // Very subtle camera-handshake drift (almost imperceptible — large
      // amplitudes made the whole field look like it was floating).
      const driftX = Math.sin(elapsed * 0.0009) * 5;
      const driftY = Math.cos(elapsed * 0.0012) * 4;
      const cx = width / 2 + driftX;
      const cy = height / 2 + driftY;

      const fadeOutStart = maxR * FADE_OUT_FACTOR;
      const fadeOutSpan = maxR - fadeOutStart;

      for (const s of stars) {
        if (elapsed < s.spawnDelay) continue;

        s.r += s.baseSpeed * speedMult * (dt / 1000);

        if (s.r > maxR) {
          const fresh = spawnStar();
          s.angle = fresh.angle;
          s.r = 0;
          s.baseSpeed = fresh.baseSpeed;
          s.streakLen = fresh.streakLen;
          s.baseAlpha = fresh.baseAlpha;
          s.seed = fresh.seed;
          s.spawnDelay = 0;
          continue;
        }

        if (s.r < 4) continue;

        const cosA = Math.cos(s.angle);
        const sinA = Math.sin(s.angle);

        const sx = cx + cosA * s.r;
        const sy = cy + sinA * s.r;

        const tailR = Math.max(0, s.r - s.streakLen);
        const tx = cx + cosA * tailR;
        const ty = cy + sinA * tailR;

        let radialAlpha;
        if (s.r < FADE_IN_PX) {
          radialAlpha = s.r / FADE_IN_PX;
        } else if (s.r > fadeOutStart) {
          radialAlpha = 1 - (s.r - fadeOutStart) / fadeOutSpan;
        } else {
          radialAlpha = 1;
        }

        const speedRatio = (s.baseSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
        // Wide depth contrast so slow stars read as "distant background"
        // rather than blending with the foreground streaks.
        const depthContrast = 0.12 + speedRatio * 0.93;
        const intensity =
          radialAlpha * s.baseAlpha * depthContrast * (0.3 + speedMult * 0.7);
        if (intensity < 0.02) continue;

        const hueDrift = (s.seed - 0.5) * 36;
        const hue = 200 + speedMult * 30 + hueDrift;

        // Slow stars: low saturation (≈ grey-white pinpoints).
        // Fast stars: higher saturation (≈ vivid blue/purple streaks).
        const sat = 30 + speedRatio * 50;
        const thicknessBase = 0.3 + speedRatio * 2.2;

        if (intensity > 0.4) {
          const glow = ctx.createLinearGradient(tx, ty, sx, sy);
          glow.addColorStop(0, `hsla(${hue}, ${sat}%, 70%, 0)`);
          glow.addColorStop(0.7, `hsla(${hue}, ${sat}%, 72%, ${intensity * 0.08})`);
          glow.addColorStop(0.96, `hsla(${hue}, ${sat}%, 72%, ${intensity * 0.32})`);
          glow.addColorStop(1, `hsla(${hue}, ${sat}%, 72%, ${intensity * 0.22})`);
          ctx.strokeStyle = glow;
          ctx.lineWidth = Math.max(2.2, intensity * 5.5);
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }

        const coreSat = Math.max(20, sat - 15);
        const core = ctx.createLinearGradient(tx, ty, sx, sy);
        core.addColorStop(0, `hsla(${hue + 8}, ${coreSat}%, 92%, 0)`);
        core.addColorStop(0.55, `hsla(${hue + 8}, ${coreSat}%, 92%, ${intensity * 0.10})`);
        core.addColorStop(0.85, `hsla(${hue + 8}, ${coreSat}%, 95%, ${intensity * 0.45})`);
        core.addColorStop(0.97, `hsla(${hue + 12}, ${Math.max(15, coreSat - 10)}%, 98%, ${intensity})`);
        core.addColorStop(1, `hsla(${hue + 12}, ${Math.max(15, coreSat - 15)}%, 99%, ${intensity * 0.85})`);
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(0.5, intensity * thicknessBase);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      clearTimers();
    };
  }, [skipped]);

  if (done) return null;

  const handleSkip = () => setSkipped(true);

  return (
    // 整塊就是「跳過」按鈕。原本是 div + onClick + role="img"：畫面明明寫著
    // click anywhere to skip，鍵盤使用者卻完全跳不過（div 不可聚焦、沒有 keydown），
    // 而且 role="img" 會把一個可互動的東西報讀成圖片。改成 <button> 後
    // 焦點、Enter/Space、語意全部原生具備。
    <button
      type="button"
      className={`intro-stage ${ending ? 'intro-stage--ending' : ''}`}
      onClick={handleSkip}
      aria-label="跳過開場動畫"
    >
      <canvas ref={canvasRef} className="intro-canvas" />
      <div className="intro-flash" aria-hidden />
      <div className="intro-skip-hint" aria-hidden>click anywhere to skip</div>
    </button>
  );
};

export default IntroAnimation;
