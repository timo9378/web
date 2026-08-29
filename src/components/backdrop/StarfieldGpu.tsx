// WebGPU 太空背景（星空 + 土星，單 canvas）——正式預設（2026-07-19 翻線，舊 pmndrs 雙 canvas 棧退役）。
//
// 架構：
//   主路徑   = worker + OffscreenCanvas（spaceGpuWorker.ts，自製極簡協定）
//   fallback = 主執行緒直接跑同一個 runner（無 OffscreenCanvas 的瀏覽器）
//   backend  = WebGPU（有 adapter）/ WebGL2（three 自動 fallback）——同一份場景碼四種組合全吃
// 場景/渲染全在 lib/starfieldGpu.ts；本元件只管 canvas 元素、訊息、徽章/量測 overlay。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// type-only：編譯期抹除，不影響 lazy dynamic import 的 chunk 邊界
import type { StarfieldRunner } from '@/lib/starfieldGpu';

const canOffscreen =
  typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

const canvasStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 1,
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

  // ── GPU device / WebGL context 掉了之後的重建 ────────────────────────────
  //
  // 為什麼需要：device 掉了是永久的，three 只會 console.error 一行（在 worker 裡連那行都
  // 看不到），renderer 之後一幀都不會再畫。實測 loseContext 後 draw call 歸零，等 15 秒、
  // 換路由都不會回來。使用者看到的就是「星空停住、切回首頁土星也不出現，但流星還在跑」——
  // 流星是 CSS/DOM 特效，跟這條管線無關。
  //
  // 重建方式是 bump generation：它同時是 <canvas> 的 key（transferControlToOffscreen 一張
  // canvas 只能做一次，所以必須換一個新的 DOM 節點）與下面那個 effect 的依賴，
  // 於是舊 worker/runner 走正常的 cleanup 收掉，新的從頭建起來。
  const [generation, setGeneration] = useState(0);
  const recoveriesRef = useRef(0);
  const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 上限存在的理由：device 一直掉的機器（驅動有問題）不該無限重建，那比不顯示更糟。
  // 用完就收掉整個 3D，由 shell 的 DOM 特效兜底。
  const MAX_RECOVERIES = 3;

  const recover = useCallback((reason: string) => {
    if (recoveriesRef.current >= MAX_RECOVERIES) {
      console.warn(`[StarfieldGpu] ${reason}；已重建 ${MAX_RECOVERIES} 次仍失敗，放棄 3D（DOM 特效繼續）`);
      setFailed(true);
      return;
    }
    recoveriesRef.current += 1;
    console.warn(`[StarfieldGpu] ${reason}；第 ${recoveriesRef.current} 次重建`);
    // 分頁還在背景時重建沒有意義（GPU 資源正是那時候被回收的），等切回來再做。
    if (document.hidden) {
      const once = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', once);
        setGeneration((g) => g + 1);
      };
      document.addEventListener('visibilitychange', once);
      return;
    }
    recoverTimerRef.current = setTimeout(() => setGeneration((g) => g + 1), 500);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(recoverTimerRef.current ?? undefined);
    },
    [],
  );

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

    // 該不該跑：分頁被隱藏時停（原本就有），有元素進入全螢幕時也停。
    //
    // 後者是在修一個實際的 bug：全螢幕影片連續 seek 到第 8~15 次會把媒體管線卡死
    // （`seeked` 永不回來、readyState 掉到 1、解碼格數 +0，只有退出全螢幕才恢復），
    // 而唯一有效的變因就是把頁面動畫停掉——停掉後同樣的測試 40/40 全過。
    // 詳細的排除過程寫在 SpaceBackdropShell 的註解裡。
    //
    // 全螢幕時這張 canvas 被 top layer 完全蓋住，停掉不影響任何看得到的東西。
    const shouldRun = () => !document.hidden && document.fullscreenElement === null;

    if (canOffscreen) {
      // ── worker 主路徑 ──
      // ⚠️ 這裡必須是字面相對路徑：vite 靠靜態分析 `new URL(…, import.meta.url)` 才認得出
      // 這是 worker 進入點並單獨打包，換成 @/ alias 它就認不出來了。
      const worker = new Worker(new URL('../../workers/spaceGpuWorker.ts', import.meta.url), { type: 'module' });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen, width, height, dpr: window.devicePixelRatio }, [offscreen]);
      // ⚠ 明送一次當下的狀態，不能只靠下面的 visibilitychange / fullscreenchange。
      //
      // 那兩個事件只在「狀態改變」時觸發，而這個元件是 lazy 的（intro 播完才掛、
      // three chunk 還要下載）——在它掛好之前就進全螢幕的話，事件早就發完了，
      // 監聽器接不到任何東西，runner 於是用預設值「跑」起來，整個全螢幕期間都在跟影片搶 GPU。
      // 實測：domcontentloaded 後 600ms 進全螢幕，一則 running 訊息都沒送出。
      // worker 端會把這個值存進 lastRunning，等 async init 完成後補套。
      worker.postMessage({ type: 'running', value: shouldRun() });
      controlRef.current = {
        scroll: (y) => worker.postMessage({ type: 'scroll', y }),
        saturn: (v, a) => worker.postMessage({ type: 'saturn', visible: v, animate: a }),
      };
      const onMsg = (
        e: MessageEvent<{
          type: string;
          backend?: string;
          fps?: number;
          avgMs?: number;
          quality?: number;
          message?: string;
        }>,
      ) => {
        if (e.data.type === 'ready') setBackend(`${e.data.backend} · worker`);
        else if (e.data.type === 'perf')
          setPerf({ fps: e.data.fps ?? 0, avgMs: e.data.avgMs ?? 0, quality: e.data.quality });
        else if (e.data.type === 'lost') recover(e.data.message ?? 'GPU device lost');
        else if (e.data.type === 'error') {
          // canvas 已 transfer、無法回收給主執行緒重用 → 本 session 放棄（外層有 DOM 特效兜底）
          console.warn('[StarfieldGpu] worker 初始化失敗:', e.data.message);
          setFailed(true);
          worker.terminate();
        }
      };
      worker.addEventListener('message', onMsg);
      const onResize = () =>
        worker.postMessage({ type: 'resize', width: canvas.clientWidth, height: canvas.clientHeight });
      const onVis = () => worker.postMessage({ type: 'running', value: shouldRun() });
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVis);
      document.addEventListener('fullscreenchange', onVis);
      return () => {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('fullscreenchange', onVis);
        // terminate() 已經讓 worker 連同監聽器一起消失，但明寫出來才對稱、也不必讓
        // 讀者去推敲 addEventListener 的對應在哪。
        worker.removeEventListener('message', onMsg);
        worker.terminate();
      };
    }

    // ── 主執行緒 fallback（同一個 runner）──
    let disposed = false;
    let runnerHandle: StarfieldRunner | null = null;
    void import('@/lib/starfieldGpu').then(async ({ createStarfieldRunner }) => {
      try {
        const { runner, backend: be } = await createStarfieldRunner({
          canvas,
          width,
          height,
          dpr: window.devicePixelRatio,
          onPerf: (fps, avgMs, quality) => setPerf({ fps, avgMs, quality }),
          onDeviceLost: (message) => {
            if (!disposed) recover(message);
          },
        });
        if (disposed) {
          runner.dispose();
          return;
        }
        runnerHandle = runner;
        // runner 預設是跑的，而 init 是 async——這段期間發生的 visibility/fullscreen 變化
        // 只會打到還是 null 的 runnerHandle 上、被靜默丟掉。補套一次當下的狀態，
        // 否則「冷啟動時就進全螢幕」會讓背景在影片播放中自己跑起來（worker 路徑同理，
        // 見 spaceGpuWorker 的 lastRunning）。
        runner.setRunning(shouldRun());
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
    const onVis = () => runnerHandle?.setRunning(shouldRun());
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onVis);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onVis);
      runnerHandle?.dispose();
    };
    // generation 變化 = device lost 之後要整組重建（canvas 換了新的 DOM 節點，見上面的註解）
  }, [generation, recover]);

  // 初始化失敗（無 WebGPU 也無 WebGL 的機器）→ 優雅消失，DOM 特效由 shell 兜底
  if (failed) return null;

  return (
    <>
      {/* key=generation：transferControlToOffscreen 一張 canvas 只能做一次，
          device lost 之後必須換一個全新的 DOM 節點才重建得起來 */}
      <canvas key={generation} ref={canvasRef} style={{ ...canvasStyle, zIndex }} />
      {/* backend 徽章：?debug=perf 才顯示（正式訪客不看 debug 資訊） */}
      {perfDebug && (
        <div
          style={{
            position: 'fixed',
            bottom: 8,
            right: 8,
            zIndex: 99999,
            padding: '6px 10px',
            background: 'rgba(0,0,0,.75)',
            color: backend.startsWith('WebGPU') ? '#7fdcff' : '#ffd27f',
            font: '12px/1.5 monospace',
            borderRadius: 6,
            pointerEvents: 'none',
          }}
        >
          StarfieldGpu · {backend} · TSL bloom
          {perf &&
            ` · ${perf.fps.toFixed(0)} fps · ${perf.avgMs.toFixed(2)} ms${perf.quality ? ` · 品質降級 L${perf.quality}` : ''}`}
        </div>
      )}
    </>
  );
}
