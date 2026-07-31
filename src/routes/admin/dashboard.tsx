import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import KoimLoader from '../../components/KoimLoader';

// 儀表板（與 /admin 同一個畫面，側欄連的是這個網址）。維持 lazy()：後台的重元件（monaco 等）要留在自己的 chunk，不進主 bundle。
const Page = lazy(() => import('../../components/admin/AdminDashboard'));

export const Route = createFileRoute('/admin/dashboard')({
  component: () => (
    <Suspense fallback={<KoimLoader inline size="sm" />}>
      <Page />
    </Suspense>
  ),
});
