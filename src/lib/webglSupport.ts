// WebGL 可用性 pre-flight probe。
//
// 背景：Chromium 137 移除了 SwiftShader WebGL fallback——硬體 context 建立失敗時
// `getContext()` 直接回 null（不再靜默降到 CPU 渲染）。加速被停用的機器（驅動
// blocklist / GPU process 崩潰過多 / 手動關閉）上，THREE.WebGLRenderer 會直接 throw。
// 官方建議：網站自行測試並處理 context 建立失敗（blink-dev "Intent to Remove:
// SwiftShader Fallback"）。
//
// 但「context 建得起來」不等於「跑得動」：使用者在瀏覽器設定裡關掉硬體加速時，
// Chrome/Edge 仍會給一個由 SwiftShader（純 CPU 光柵化）撐起來的 WebGL context。
// 兩萬多顆 instanced 星星在上面是個位數 fps——這時候降低星星數量救不了，唯一正解是
// 完全不掛 3D、直接走 DOM 特效。所以這裡連 renderer 字串一起看：軟體渲染 → 視同不可用。
//
// 用法：掛任何 R3F <Canvas> 前先呼叫；false → 不掛 WebGL、走純 DOM 特效降級。
// 結果快取（加速狀態在分頁生命週期內不會自己好轉；真的變了重整即可）。

/** SwiftShader / llvmpipe / WARP 等 CPU 光柵化器的 renderer 字串特徵 */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software|微软基本呈现/i;

let cached: boolean | null = null;
let rendererName = '';

export function isWebGLAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      cached = false;
      return cached;
    }
    // UNMASKED_RENDERER 才看得到真實裝置名；擴充被擋掉時退回 RENDERER（多半是 "WebKit WebGL"，
    // 認不出軟體渲染，那就當它是硬體——寧可誤放也不要誤殺有 GPU 的機器）
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const names = [dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, gl.getParameter(gl.RENDERER)];
    rendererName = names.map((n) => (typeof n === 'string' ? n : '')).find((n) => n !== '') ?? '';
    cached = !SOFTWARE_RENDERER.test(rendererName);
    // 釋放探測用 context（瀏覽器對同時存活的 WebGL context 數量有上限）
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}

/** 偵測到的 GPU renderer 字串（要先呼叫過 isWebGLAvailable）。給 ?debug=perf 顯示用。 */
export function getGpuRenderer(): string {
  return rendererName;
}

/**
 * 「這台機器沒有可用的 GPU 合成」→ 該走最省的降級模式。
 *
 * 涵蓋兩種情況，因為兩種的結論一樣（所有合成都落在 CPU）：
 *   1. 拿得到 WebGL context，但 renderer 是 SwiftShader/llvmpipe/WARP（使用者關掉硬體加速，
 *      瀏覽器仍給一個 CPU 光柵化的 context）。
 *   2. 完全拿不到 context——Chromium 137 之後硬體 context 失敗就直接回 null，不再靜默降到
 *      SwiftShader。這代表 GPU 行程根本沒起來，同樣沒有 GPU 合成可言。
 */
export function isSoftwareRenderer(): boolean {
  const ok = isWebGLAvailable();
  return !ok;
}
