// WebGPU 星空 worker entry——純訊息轉接（場景/渲染邏輯全在 lib/starfieldGpu.ts，
// 與主執行緒 fallback 共用同一份 code）。
//
// 汰換 @react-three/offscreen 的理由（實測過的坑）：
//   ‧ 它的協定走 structured clone，傳不了 WebGPURenderer 需要的 async factory
//   ‧ handleProps 無 try/catch（init 失敗後任何 props 訊息都在 worker 內 uncaught throw）
//   ‧ worker 內 shim self.document={} 干擾環境判定
// 這裡協定極簡：init / resize / running 三種訊息，錯誤一律回報主執行緒處理。
import { createStarfieldRunner, type StarfieldRunner } from '../lib/starfieldGpu';

interface InitMsg { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; dpr: number }
interface ResizeMsg { type: 'resize'; width: number; height: number }
interface RunningMsg { type: 'running'; value: boolean }
interface ScrollMsg { type: 'scroll'; y: number }
interface SaturnMsg { type: 'saturn'; visible: boolean; animate: boolean }
type InMsg = InitMsg | ResizeMsg | RunningMsg | ScrollMsg | SaturnMsg;

let runner: StarfieldRunner | null = null;
// init 是 async（renderer.init + 貼圖）——先到的狀態訊息記下來，ready 後補放
let lastScroll = 0;
let lastSaturn: { visible: boolean; animate: boolean } | null = null;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    void (async () => {
      try {
        const { runner: r, backend } = await createStarfieldRunner({
          canvas: msg.canvas,
          width: msg.width,
          height: msg.height,
          dpr: msg.dpr,
          onPerf: (fps, avgMs, quality) => self.postMessage({ type: 'perf', fps, avgMs, quality }),
        });
        runner = r;
        runner.setScroll(lastScroll);
        if (lastSaturn) runner.setSaturn(lastSaturn.visible, lastSaturn.animate);
        self.postMessage({ type: 'ready', backend });
      } catch (err) {
        self.postMessage({ type: 'error', message: String(err) });
      }
    })();
  } else if (msg.type === 'resize') {
    runner?.setSize(msg.width, msg.height);
  } else if (msg.type === 'running') {
    runner?.setRunning(msg.value);
  } else if (msg.type === 'scroll') {
    lastScroll = msg.y;
    runner?.setScroll(msg.y);
  } else {
    // 到這裡 union 只剩 SaturnMsg，再比對一次 msg.type 是恆真。
    // 日後新增訊息型別時，下面存取 msg.visible/msg.animate 會編譯失敗——不會被靜默吞掉。
    lastSaturn = { visible: msg.visible, animate: msg.animate };
    runner?.setSaturn(msg.visible, msg.animate);
  }
};
