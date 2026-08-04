// 3D 背景專用 ErrorBoundary——背景裝飾永遠不准殺死整個 app。
//
// 背景：R3F <Canvas> 在 WebGL context 建立失敗時會在 React render 流程內 throw
// （Chromium 137 移除 SwiftShader fallback 後真實發生：朋友的 RTX 5060 + Edge 150，
// 硬體加速被停用 → getContext 回 null → THREE throw → 無人接 → React 卸載整個 root
// → 整頁白掉）。probe（webglSupport.ts）擋掉大多數，這裡兜 runtime 才炸的殘餘情況
// （GPU process 中途死亡、offscreen fallback 掛主執行緒 Canvas 失敗等）。
import { Component, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class BackdropErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // 背景失敗只記 log 不上報——功能無損，且這類機器通常也連不上第三方
    console.warn('[SpaceBackdrop] 3D 背景初始化失敗，降級為 DOM 特效:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
