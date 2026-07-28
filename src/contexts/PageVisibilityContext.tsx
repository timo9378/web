import { createContext, use, type ReactNode } from 'react';

interface PageVisibilityValue {
  isVisible: boolean;
}

// 創建 Page Visibility Context
const PageVisibilityContext = createContext<PageVisibilityValue | undefined>(undefined);

// Provider 組件
export const PageVisibilityProvider = ({ children, isVisible }: { children: ReactNode; isVisible: boolean }) => {
  return (
    <PageVisibilityContext value={{ isVisible }}>
      {children}
    </PageVisibilityContext>
  );
};

// Hook 來使用 Page Visibility Context
export const usePageVisibility = () => {
  const context = use(PageVisibilityContext);
  if (context === undefined) {
    throw new Error('usePageVisibility must be used within a PageVisibilityProvider');
  }
  return context;
};
