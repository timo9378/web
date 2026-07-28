import type { ReactNode } from 'react';
import { PageVisibilityContext } from './pageVisibility';

// 本檔只 export Provider 元件；context 物件與 usePageVisibility hook 在 ./pageVisibility。
// 元件與非元件混在同一模組會讓 Fast Refresh 對整支檔案退回整頁重載。
export const PageVisibilityProvider = ({ children, isVisible }: { children: ReactNode; isVisible: boolean }) => {
  return (
    <PageVisibilityContext value={{ isVisible }}>
      {children}
    </PageVisibilityContext>
  );
};
