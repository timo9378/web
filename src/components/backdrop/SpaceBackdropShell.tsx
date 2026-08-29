import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { useRouterState } from '@tanstack/react-router';
import IntroAnimation from './IntroAnimation';
import BackdropErrorBoundary from './BackdropErrorBoundary';
import DomSpaceEffects from './DomSpaceEffects';
import { isSoftwareRenderer, isWebGLAvailable } from '@/lib/webglSupport';
import { stripLocalePrefix } from '@/i18n/start-i18n';

// WebGPU 太空背景（星空+土星單 canvas，three/webgpu 獨立 lazy chunk，不進主 bundle）。
// 2026-07-19 翻預設：取代舊 pmndrs 雙 canvas 棧（strangler 完成）。
const LazyStarfieldGpu = lazy(() => import('./StarfieldGpu'));

// 桌面 WebGL 背景 + 首訪首頁開場動畫(Saturn explosion)的編排殼。
// 整包只在 client 跑(由 __root 以 ClientOnly + lazy 掛載)→ three.js / IntroAnimation 永不進 SSR。
// 對齊舊 App.tsx 的 intro 狀態機,但「不再 gate 內容」:SSR 內容已先繪出,intro 純粹疊在上層淡出。
export default function SpaceBackdropShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOnHomePage = stripLocalePrefix(pathname) === '';
  const isMobile = useMediaQuery('(max-width: 768px)');
  // 爬蟲 / 稽核工具（Googlebot/Bingbot/Lighthouse…）：跟手機一樣完全不載 three。
  // 純裝飾背景、無內容 → 不算 cloaking；手機版本來就跳過故對 Google 一致；真人 UA 不含這些關鍵字，
  // 體驗不變。好處：桌機爬蟲/Rich Results/社群卡片抓取器不再卡在重的 WebGL render。
  const isBot = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /bot|crawl|spider|lighthouse|headless|slurp|bingbot|googlebot|duckduckbot|baiduspider|yandex/i.test(
        navigator.userAgent,
      ),
    [],
  );
  // 3D pre-flight：WebGPU（renderer 首選）或 WebGL（自動 fallback backend）任一可用才掛 3D；
  // 都沒有（Chromium 137 移除 SwiftShader 後加速全壞的機器）→ 不下載 three chunk，降級純 DOM 特效。
  //
  // 另一種必須擋掉的情況：使用者在瀏覽器設定關掉硬體加速。此時 WebGL context 建得起來（跑
  // SwiftShader）、navigator.gpu 也還在，兩個檢查都會過，結果 3D 用 CPU 光柵化整站卡死——降低
  // 星星數量救不了，得完全不掛 3D。偵測到軟體渲染就直接走 DOM 特效（WebGPU 的 Dawn 在這種機器
  // 上同樣只會拿到 SwiftShader/WARP，所以一個檢查擋兩條路）。
  // 本元件 client-only，可安全 probe。runtime 才炸的殘餘情況由 ErrorBoundary + worker error 通道接。
  const softwareGpu = useMemo(() => isSoftwareRenderer(), []);
  const gpu3dOk = useMemo(() => !softwareGpu && (isWebGLAvailable() || 'gpu' in navigator), [softwareGpu]);

  // 軟體渲染 → 在 <html> 掛 .no-gpu，讓 CSS 一次關掉整站最貴的那些效果（見 index.css）
  useEffect(() => {
    if (!softwareGpu) return;
    document.documentElement.classList.add('no-gpu');
    return () => document.documentElement.classList.remove('no-gpu');
  }, [softwareGpu]);

  // 有元素進入全螢幕時，整包背景卸載。
  //
  // 這不是效能潔癖，是修一個真的 bug：文章頁的影片在全螢幕下連續 seek，第 8~15 次就會把
  // 媒體管線卡死——`seeking` 發出去、`seeked` 永遠不回來、readyState 掉到 1、解碼格數 +0、
  // `paused` 仍是 false，而且 `load()` 都救不回來，只有退出全螢幕才恢復。
  //
  // 逐項排除後（換全螢幕元素、換編碼、換解析度、關控制列毛玻璃、Blob 播、裸 DOM 播都照卡），
  // 唯一有效的變因是「把頁面動畫停掉」：同一台機器、同一個 profile、同一次載入，
  // 有動畫時第 10 次卡死，停掉動畫後 40/40 全過。搶 GPU 的是這幾層——StarfieldGpu 的
  // WebGPU/WebGL context、CursorTrail 那張全視窗 2D canvas（滑鼠一動就每幀重畫，而
  // 「點時間軸」正好一直在動滑鼠）、外加流星/UFO 那些 infinite 動畫。
  //
  // Chrome/Brave 撐得住、Edge 撐不住，但壓力是我們給的，所以這是我們該修的。
  // 全螢幕時這些特效本來就被 top layer 蓋住、一個像素都看不到，卸載純賺。
  //
  // ⚠️ `fullscreenchange` 只由 Fullscreen API 觸發，F11 的瀏覽器全螢幕**不會**進到這裡
  //   —— 一般閱讀（含 F11 全螢幕閱讀）的背景完全不受影響。
  //
  // 用 class 而不是卸載元件：卸載就得重掛，WebGPU context 重建是另一個會壞的地方，
  // 而且退出全螢幕時會看到星空重新淡入。掛 class 只是讓它們停下來，元件狀態原封不動。
  // 兩個 JS 迴圈（StarfieldGpu 的 worker、CursorTrail 的 rAF）各自也讀這個狀態暫停，
  // 因為 `display:none` 擋得住合成、擋不住它們繼續送 GPU 指令。
  useEffect(() => {
    const onFs = () => {
      document.documentElement.classList.toggle('fs-active', document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.documentElement.classList.remove('fs-active');
    };
  }, []);

  const introCompleted = (() => {
    try {
      return sessionStorage.getItem('introCompleted') === 'true';
    } catch {
      return false;
    }
  })();
  // intro 只在「首次造訪 + 桌面 + 首頁」播
  const shouldSkipIntro = introCompleted || !isOnHomePage || isMobile;

  const [animateSaturn, setAnimateSaturn] = useState(shouldSkipIntro);
  const [saturnZIndex, setSaturnZIndex] = useState(1);
  const [introVisible, setIntroVisible] = useState(!shouldSkipIntro);
  const [backdropReady, setBackdropReady] = useState(shouldSkipIntro && !isMobile);
  const introCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExplosionStart = () => {
    setSaturnZIndex(10000);
    setTimeout(() => {
      setAnimateSaturn(true);
    }, 200);
  };
  // intro 加速期已過 → 現在才掛 3D 背景(土星在 explosion 前約 1.1s 就緒)
  const handlePreReveal = useCallback(() => {
    setBackdropReady(true);
    document.documentElement.classList.remove('intro-pending'); // 內容在 intro bloom 下淡入(配合 __root pre-paint gate)
  }, []);
  const handleAnimationComplete = () => {
    try {
      sessionStorage.setItem('introCompleted', 'true');
    } catch {
      /* sessionStorage 不可用就略過 */
    }
    clearTimeout(introCompleteTimeoutRef.current ?? undefined);
    introCompleteTimeoutRef.current = setTimeout(() => {
      setIntroVisible(false);
      setSaturnZIndex(1);
    }, 300);
  };

  useEffect(
    () => () => {
      clearTimeout(introCompleteTimeoutRef.current ?? undefined);
    },
    [],
  );

  // intro 不會播(重訪/非首頁/手機 → introVisible 一開始就 false)→ 立即放行內容,別讓 pre-paint gate 卡住。
  useEffect(() => {
    if (!introVisible) document.documentElement.classList.remove('intro-pending');
  }, [introVisible]);

  if (isMobile || isBot) return null; // 手機 / 爬蟲：完全不載 three

  return (
    <>
      {introVisible && (
        <IntroAnimation
          onAnimationComplete={handleAnimationComplete}
          onExplosionStart={handleExplosionStart}
          onPreReveal={handlePreReveal}
        />
      )}
      {/* 3D 背景（WebGPU/WebGL2 自動選 backend）。runtime 才炸由 ErrorBoundary 接；
          worker 內失敗則 StarfieldGpu 自行歸 null——兩種情況 DOM 特效都還在（下方獨立掛載）。 */}
      {backdropReady && gpu3dOk && (
        <BackdropErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <LazyStarfieldGpu isOnHomePage={isOnHomePage} animateSaturn={animateSaturn} zIndex={saturnZIndex} />
          </Suspense>
        </BackdropErrorBoundary>
      )}
      {/* DOM 特效（流星/UFO/游標尾跡，非 WebGL）：無論 3D 成敗都掛，頁面永遠有生命感。
          例外是「使用者關掉硬體加速」：整站合成、backdrop-filter、上百個 infinite 動畫全落在
          CPU，連純 DOM 特效都會拖垮捲動——這種機器只留靜態背景。 */}
      {backdropReady && !softwareGpu && <DomSpaceEffects isMobile={isMobile} isOnHomePage={isOnHomePage} />}
    </>
  );
}
