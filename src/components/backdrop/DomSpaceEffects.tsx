// 純 DOM/CSS 太空特效（零 three 依賴）——SpaceBackdrop 的非 WebGL 區塊抽出共用。
// 兩個用途：
//   1. SpaceBackdrop 內的正常掛載（跟 WebGL canvas 並存）
//   2. WebGL 不可用（Chromium 137 移除 SwiftShader 後 context 建立失敗）或
//      3D 背景 runtime 崩潰（BackdropErrorBoundary fallback）時的降級——頁面仍有生命感，
//      且完全不載 vendor-three chunk。
import ForegroundStars from './ForegroundStars';
import RandomShootingStars from './RandomShootingStars';
import RandomComets from './RandomComets';
import RandomUFOs from './RandomUFOs';
import CursorTrail from './CursorTrail';

interface DomSpaceEffectsProps {
  isMobile: boolean;
  isOnHomePage: boolean;
}

export default function DomSpaceEffects({ isMobile, isOnHomePage }: DomSpaceEffectsProps) {
  return (
    <>
      {isOnHomePage && <ForegroundStars count={isMobile ? 5 : 15} />}
      {isOnHomePage && !isMobile && <RandomShootingStars />}
      {isOnHomePage && !isMobile && <RandomComets />}
      {isOnHomePage && <RandomUFOs />}
      {/* CursorTrail 自身無 props：定位/層級全由 CursorTrail.css 處理 */}
      {!isMobile && <CursorTrail />}
    </>
  );
}
