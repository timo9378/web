// WebGPU 太空背景（星空 + 土星，單 canvas）——正式預設（2026-07-19 翻線，舊 pmndrs 雙 canvas 棧退役）。
//
// 架構：
//   主路徑   = worker + OffscreenCanvas（spaceGpuWorker.ts，自製極簡協定）
//   fallback = 主執行緒直接跑同一個 runner（無 OffscreenCanvas 的瀏覽器）
//   backend  = WebGPU（有 adapter）/ WebGL2（three 自動 fallback）——同一份場景碼四種組合全吃
// 場景/渲染全在 lib/starfieldGpu.ts；本元件只管 canvas 元素、訊息、徽章/量測 overlay。
import { useEffect, useMemo, useRef, useState } from 'react';
// type-only：編譯期抹除，不影響 lazy dynamic import 的 chunk 邊界
import type { StarfieldRunner } from '../lib/starfieldGpu';

const canOffscreen =
  typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

const canvasStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1,
};

interface StarfieldGpuProps {
  /** 土星僅首頁顯示（對齊舊架構的 isOnHomePage gating） */
  isOnHomePage?: boolean;
  /** intro 爆炸前為 false（土星維持 epsilon 縮放、管線先編譯好），爆炸時轉 true 放大 */
  animateSaturn?: boolean;
  /** intro 爆炸期整張 canvas 抬到 intro 遮罩之上（對齊舊 saturnZIndex 機制） */
  zIndex?: number;
}

export default function StarfieldGpu({ isOnHomePage = false, animateSaturn = true, zIndex = 1 }: StarfieldGpuProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [backend, setBackend] = useState('初始化中…');
  const [failed, setFailed] = useState(false);
  const [perf, setPerf] = useState<{ fps: number; avgMs: number; quality?: number } | null>(null);
  const perfDebug = useMemo(() => new URLSearchParams(window.location.search).get('debug') === 'perf', []);
  // 統一控制介面：worker 路徑=postMessage、主執行緒路徑=直呼 runner（見下兩個 effect）
  const controlRef = useRef<{ scroll(y: number): void; saturn(v: boolean, a: boolean): void } | null>(null);

  // 捲動轉發（worker 無 window）+ 土星顯示（僅首頁）——控制介面就緒後立即同步當前狀態
  useEffect(() => {
    const onScroll = () => controlRef.current?.scroll(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    controlRef.current?.saturn(isOnHomePage, animateSaturn);
    controlRef.current?.scroll(window.scrollY);
    return () => window.removeEventListener('scroll', onScroll);
  }, [isOnHomePage, animateSaturn, backend]); // backend 變化 = runner 就緒的訊號，重新同步

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canOffscreen) {
      // ── worker 主路徑 ──
      const worker = new Worker(new URL('../workers/spaceGpuWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage(
        { type: 'init', canvas: offscreen, width, height, dpr: window.devicePixelRatio },
        [offscreen],
      );
      controlRef.current = {
        scroll: (y) => worker.postMessage({ type: 'scroll', y }),
        saturn: (v, a) => worker.postMessage({ type: 'saturn', visible: v, animate: a }),
      };
      const onMsg = (e: MessageEvent<{ type: string; backend?: string; fps?: number; avgMs?: number; quality?: number; message?: string }>) => {
        if (e.data.type === 'ready') setBackend(`${e.data.backend} · worker`);
        else if (e.data.type === 'perf') setPerf({ fps: e.data.fps ?? 0, avgMs: e.data.avgMs ?? 0, quality: e.data.quality });
        else if (e.data.type === 'error') {
          // canvas 已 transfer、無法回收給主執行緒重用 → 本 session 放棄（外層有 DOM 特效兜底）
          console.warn('[StarfieldGpu] worker 初始化失敗:', e.data.message);
          setFailed(true);
          worker.terminate();
        }
      };
      worker.addEventListener('message', onMsg);
      const onResize = () => worker.postMessage({ type: 'resize', width: canvas.clientWidth, height: canvas.clientHeight });
      const onVis = () => worker.postMessage({ type: 'running', value: !document.hidden });
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVis);
      return () => {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        // terminate() 已經讓 worker 連同監聽器一起消失，但明寫出來才對稱、也不必讓
        // 讀者去推敲 addEventListener 的對應在哪。
        worker.removeEventListener('message', onMsg);
        worker.terminate();
      };
    }

    // ── 主執行緒 fallback（同一個 runner）──
    let disposed = false;
    let runnerHandle: StarfieldRunner | null = null;
    void import('../lib/starfieldGpu').then(async ({ createStarfieldRunner }) => {
      try {
        const { runner, backend: be } = await createStarfieldRunner({
          canvas, width, height, dpr: window.devicePixelRatio,
          onPerf: (fps, avgMs, quality) => setPerf({ fps, avgMs, quality }),
        });
        if (disposed) { runner.dispose(); return; }
        runnerHandle = runner;
        controlRef.current = {
          scroll: (y) => runner.setScroll(y),
          saturn: (v, a) => runner.setSaturn(v, a),
        };
        setBackend(`${be} · main`);
      } catch (err) {
        console.warn('[StarfieldGpu] 主執行緒初始化失敗:', err);
        setFailed(true);
      }
    });
    const onResize = () => runnerHandle?.setSize(canvas.clientWidth, canvas.clientHeight);
    const onVis = () => runnerHandle?.setRunning(!document.hidden);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      runnerHandle?.dispose();
    };
  }, []);

  // 初始化失敗（無 WebGPU 也無 WebGL 的機器）→ 優雅消失，DOM 特效由 shell 兜底
  if (failed) return null;

  return (
    <>
      <canvas ref={canvasRef} style={{ ...canvasStyle, zIndex }} />
      {/* backend 徽章：?debug=perf 才顯示（正式訪客不看 debug 資訊） */}
      {perfDebug && (
        <div style={{
          position: 'fixed', bottom: 8, right: 8, zIndex: 99999, padding: '6px 10px',
          background: 'rgba(0,0,0,.75)',
          color: backend.startsWith('WebGPU') ? '#7fdcff' : '#ffd27f',
          font: '12px/1.5 monospace', borderRadius: 6, pointerEvents: 'none',
        }}>
          StarfieldGpu · {backend} · TSL bloom
          {perf && ` · ${perf.fps.toFixed(0)} fps · ${perf.avgMs.toFixed(2)} ms${perf.quality ? ` · 品質降級 L${perf.quality}` : ''}`}
        </div>
      )}
    </>
  );
}
