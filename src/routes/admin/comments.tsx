import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import KoimLoader from '@/components/common/KoimLoader';

// 留言管理。維持 lazy()：後台的重元件（monaco 等）要留在自己的 chunk，不進主 bundle。
const Page = lazy(() => import('../../components/admin/CommentsManager'));

export const Route = createFileRoute('/admin/comments')({
  component: () => (
    <Suspense fallback={<KoimLoader inline size="sm" />}>
      <Page />
    </Suspense>
  ),
});
