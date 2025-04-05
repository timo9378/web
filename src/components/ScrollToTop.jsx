import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 每次路徑變更時，滾動到頁面頂部
    window.scrollTo(0, 0);
  }, [pathname]); // 依賴 pathname，當路徑改變時觸發 effect

  return null; // 這個元件不需要渲染任何內容
}

export default ScrollToTop;
