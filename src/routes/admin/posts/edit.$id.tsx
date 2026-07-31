import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import KoimLoader from '../../../components/KoimLoader';

// 編輯既有文章。`$id` 是動態段，PostEditor 用 Route.useParams() 取。
const Page = lazy(() => import('../../../components/admin/PostEditor'));

export const Route = createFileRoute('/admin/posts/edit/$id')({
  component: () => (
    <Suspense fallback={<KoimLoader inline size="sm" />}>
      <Page />
    </Suspense>
  ),
});
