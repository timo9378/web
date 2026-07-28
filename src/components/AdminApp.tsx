import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useAuth } from '../contexts/auth';
import KoimLoader from './KoimLoader';

// 後台子應用(私有、無 SEO):整包保留 react-router,以 ClientOnly island 掛在 TanStack 的 /admin/$ 之下。
// basename="/admin" → 內部路由相對於 /admin;monaco 等重元件全留在這個 client-only chunk。
const LazyAdminLayout = lazy(() => import('./admin/AdminLayout'));
const LazyAdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const LazyPostEditor = lazy(() => import('./admin/PostEditor'));
const LazyPostsList = lazy(() => import('./admin/PostsList'));
const LazyCategoriesManager = lazy(() => import('./admin/CategoriesManager'));
const LazyTagsManager = lazy(() => import('./admin/TagsManager'));
const LazyBooksManager = lazy(() => import('./admin/BooksManager'));
const LazyArticleGenerator = lazy(() => import('./admin/ArticleGenerator'));
const LazyCommentsManager = lazy(() => import('./admin/CommentsManager'));
const LazySubscribersManager = lazy(() => import('./admin/SubscribersManager'));
const LazyUsersManager = lazy(() => import('./admin/UsersManager'));

const LoadingFallback = () => <KoimLoader inline size="sm" />;

const AdminPlaceholder = ({ title }: { title: string }) => (
  <div style={{ padding: '2rem', color: 'white', background: '#1a202c', borderRadius: '8px', margin: '2rem' }}>
    <h2 style={{ borderBottom: '1px solid #333', paddingBottom: '1rem' }}>{title}</h2>
    <p style={{ marginTop: '1rem' }}>此頁面功能正在開發中。</p>
  </div>
);

// 路由保護:非 ADMIN/OWNER → 整頁導回站台首頁(用 window.location 跳出 /admin basename)。
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoggedIn, loading } = useAuth();
  const allowed = isLoggedIn && (user?.role === 'ADMIN' || user?.role === 'OWNER');
  useEffect(() => {
    if (!loading && !allowed) window.location.replace('/');
  }, [loading, allowed]);
  if (loading) return <LoadingFallback />;
  if (!allowed) return <LoadingFallback />;
  return children;
}

const lazyEl = (El: React.ComponentType) => (
  <Suspense fallback={<LoadingFallback />}><El /></Suspense>
);

export default function AdminApp() {
  // 不用 basename:AdminLayout 內部連結是絕對的 /admin/...,所以路由就以 /admin 前綴定義(對齊舊 App.tsx),
  // 避免 basename 疊出 /admin/admin/... 雙前綴。
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/login" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<RequireAdmin>{lazyEl(LazyAdminLayout)}</RequireAdmin>}>
          <Route index element={lazyEl(LazyAdminDashboard)} />
          <Route path="dashboard" element={lazyEl(LazyAdminDashboard)} />
          <Route path="posts" element={lazyEl(LazyPostsList)} />
          <Route path="posts/create" element={lazyEl(LazyPostEditor)} />
          <Route path="posts/edit/:id" element={lazyEl(LazyPostEditor)} />
          <Route path="categories" element={lazyEl(LazyCategoriesManager)} />
          <Route path="tags" element={lazyEl(LazyTagsManager)} />
          <Route path="books" element={lazyEl(LazyBooksManager)} />
          <Route path="article-generator" element={lazyEl(LazyArticleGenerator)} />
          <Route path="comments" element={lazyEl(LazyCommentsManager)} />
          <Route path="subscribers" element={lazyEl(LazySubscribersManager)} />
          <Route path="users" element={lazyEl(LazyUsersManager)} />
          <Route path="notes" element={<AdminPlaceholder title="日記管理" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
