import './KoimLoader.css';

interface KoimLoaderProps {
  /** 預設 md */
  size?: 'sm' | 'md' | 'lg';
  /** 載入文字（可省略） */
  text?: string;
  /** 是否撐滿視窗高度（預設 false） */
  fullscreen?: boolean;
  /** 內嵌模式：尺寸縮小且不留白（用於 Suspense fallback） */
  inline?: boolean;
}

/**
 * 全站統一 loader：雙層軌道 + 漸層核心 + 紫光暈呼吸
 */
function KoimLoader({ size = 'md', text, fullscreen = false, inline = false }: KoimLoaderProps) {
  const cls = [
    'koim-loader-shell',
    `koim-loader-shell--${size}`,
    fullscreen ? 'koim-loader-shell--fullscreen' : '',
    inline ? 'koim-loader-shell--inline' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // role="status" + aria-live 是載入指示器的標準 live-region 寫法；
    // <output> 的語意是「表單運算結果」，跟這裡不是同一回事
    // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
    <div className={cls} role="status" aria-busy="true" aria-live="polite">
      <div className="koim-loader" aria-hidden>
        <div className="koim-loader-orbit koim-loader-orbit-1" />
        <div className="koim-loader-orbit koim-loader-orbit-2" />
        <div className="koim-loader-core" />
        <div className="koim-loader-glow" />
      </div>
      {text && (
        <p className="koim-loader-text">
          {text}
          <span className="koim-loader-dots">
            <i></i>
            <i></i>
            <i></i>
          </span>
        </p>
      )}
    </div>
  );
}

export default KoimLoader;
