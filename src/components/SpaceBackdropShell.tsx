import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { useRouterState } from '@tanstack/react-router';
import IntroAnimation from './IntroAnimation';
import BackdropErrorBoundary from './BackdropErrorBoundary';
import DomSpaceEffects from './DomSpaceEffects';
import { isSoftwareRenderer, isWebGLAvailable } from '../lib/webglSupport';
import { stripLocalePrefix } from '../start-i18n';

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
    () => typeof navigator !== 'undefined'
      && /bot|crawl|spider|lighthouse|headless|slurp|bingbot|googlebot|duckduckbot|baiduspider|yandex/i.test(navigator.userAgent),
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
  const gpu3dOk = useMemo(() => !isSoftwareRenderer() && (isWebGLAvailable() || 'gpu' in navigator), []);

  const introCompleted = (() => {
    try { return sessionStorage.getItem('introCompleted') === 'true'; } catch { return false; }
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
    setTimeout(() => { setAnimateSaturn(true); }, 200);
  };
  // intro 加速期已過 → 現在才掛 3D 背景(土星在 explosion 前約 1.1s 就緒)
  const handlePreReveal = useCallback(() => {
    setBackdropReady(true);
    document.documentElement.classList.remove('intro-pending'); // 內容在 intro bloom 下淡入(配合 __root pre-paint gate)
  }, []);
  const handleAnimationComplete = () => {
    try { sessionStorage.setItem('introCompleted', 'true'); } catch { /* sessionStorage 不可用就略過 */ }
    clearTimeout(introCompleteTimeoutRef.current ?? undefined);
    introCompleteTimeoutRef.current = setTimeout(() => {
      setIntroVisible(false);
      setSaturnZIndex(1);
    }, 300);
  };

  useEffect(() => () => { clearTimeout(introCompleteTimeoutRef.current ?? undefined); }, []);

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
            <LazyStarfieldGpu
              isOnHomePage={isOnHomePage}
              animateSaturn={animateSaturn}
              zIndex={saturnZIndex}
            />
          </Suspense>
        </BackdropErrorBoundary>
      )}
      {/* DOM 特效（流星/UFO/游標尾跡，非 WebGL）：無論 3D 成敗都掛，頁面永遠有生命感 */}
      {backdropReady && <DomSpaceEffects isMobile={isMobile} isOnHomePage={isOnHomePage} />}
    </>
  );
}
