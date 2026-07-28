import { createContext, use } from 'react';

// context 物件與 hook 放在純 .ts：Provider 元件留在 PageVisibilityContext.tsx。
// 元件與非元件混在同一模組會讓 Vite Fast Refresh 對整支檔案退回整頁重載
// （react-refresh only-export-components）。

export interface PageVisibilityValue {
  isVisible: boolean;
}

export const PageVisibilityContext = createContext<PageVisibilityValue | undefined>(undefined);

export const usePageVisibility = () => {
  const context = use(PageVisibilityContext);
  if (context === undefined) {
    throw new Error('usePageVisibility must be used within a PageVisibilityProvider');
  }
  return context;
};
