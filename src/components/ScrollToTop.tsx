import { useEffect, useRef } from 'react';
import { useRouterState } from '@tanstack/react-router';

function ScrollToTop() {
  const location = useRouterState({ select: (s) => s.location });
  const { pathname, hash } = location;
  const state = location.state as { fromPreview?: boolean } | null;
  const prevPathnameRef = useRef(pathname);

  useEffect(() => {
    // 只在路徑 (pathname) 真正改變時才滾動到頂部
    // 如果只是 hash 改變（錨點跳轉），不干涉滾動行為
    // 如果是從 preview scroll-to-commit 過來，也不滾頂端（BlogPost 會還原到段落位置）
    if (pathname !== prevPathnameRef.current) {
      if (!hash && !state?.fromPreview) {
        window.scrollTo(0, 0);
      }
      prevPathnameRef.current = pathname;
    }
  }, [pathname, hash, state]);

  return null;
}

export default ScrollToTop;
