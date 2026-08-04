/// <reference types="vite/client" />

// Swiper 的 CSS 副作用 import 沒有型別宣告，補上避免 tsc 報 TS2882
declare module 'swiper/css';
declare module 'swiper/css/*';

// @fontsource-variable 字型套件的副作用 import 沒有型別宣告
declare module '@fontsource-variable/*';

// 自訂的 VITE_* 環境變數。不宣告的話 import.meta.env.X 是 any，
// 打錯名字不會有任何提示（而錯誤上報「沒設就靜靜不啟用」，打錯等於沒裝）。
interface ImportMetaEnv {
  /** 錯誤上報用的（假）DSN；空／未設 = 不啟用。見 src/lib/errorReporting.ts */
  readonly VITE_SENTRY_DSN?: string;
  /** 版本標記，讓 GlitchTip 能把 issue 歸到某次部署。未設則 SDK 不帶 release。 */
  readonly VITE_RELEASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
