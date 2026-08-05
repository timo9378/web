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
  /**
   * Plausible v3 的站台專屬腳本檔名，例如 `pa-KHBhcGG6B_XCFx5Uwsa-d.js`。
   * 在後台 Site Settings 的安裝畫面複製 snippet 就看得到（src 的最後一段）。
   * 站台名與「Outbound links / File downloads / Form submissions」等選項都烤在
   * 這個檔案裡，所以前端不需要再給 data-domain。
   * 空／未設 = 不掛追蹤腳本。dev 與 e2e 都不會設，所以不會送出任何事件。
   * 見 src/routes/__root.tsx。
   */
  readonly VITE_PLAUSIBLE_SCRIPT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
