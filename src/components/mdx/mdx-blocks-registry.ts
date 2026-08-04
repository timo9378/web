import {
  Annot, BarChart, Chart, CodeTabs, Details, Diff, FileTree, ImageCompare, Install, InteractiveChart,
  Kbd, Math, Mention, Note, Poll, Refs, Ruby, Sketch, Spoiler, Stat, Stats, Step, Steps, Tab, Tabs, Video, YouTube,
} from './mdx-blocks';

/**
 * MDX 渲染可用的自訂 block。key = 文章裡寫的標籤名。
 *
 * 獨立成一個檔而不是留在 MdxContent.tsx，有兩個理由：
 *   1. 從元件檔匯出常數會壞掉 Fast Refresh（oxlint 的 react/only-export-components）
 *   2. scripts/check-mdx.ts 要拿這份名單檢查「文章用到的 block 有沒有註冊」。
 *      那支是純 node 腳本，import 不動 React 元件，所以它用 regex 讀本檔——
 *      而 regex 解得對不對由 mdx-blocks-registry.test.ts 對照真的 Object.keys 驗。
 */
export const MDX_BLOCKS = {
  Note, Annot, Spoiler, BarChart, Ruby, Mention, CodeTabs, Math, Tabs, Tab, Sketch, Chart, InteractiveChart,
  Diff, Install, ImageCompare, Kbd, Details, Steps, Step, FileTree, Stats, Stat, Video, YouTube, Refs, Poll,
};
