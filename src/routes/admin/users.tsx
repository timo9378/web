import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import KoimLoader from '@/components/common/KoimLoader';

// 用戶管理（側欄僅 OWNER 可見）。維持 lazy()：後台的重元件（monaco 等）要留在自己的 chunk，不進主 bundle。
const Page = lazy(() => import('../../components/admin/UsersManager'));

export const Route = createFileRoute('/admin/users')({
  component: () => (
    <Suspense fallback={<KoimLoader inline size="sm" />}>
      <Page />
    </Suspense>
  ),
});
