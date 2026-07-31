import { createFileRoute, redirect } from '@tanstack/react-router';

// /admin/login 是歷史網址（舊後台有獨立登入頁）。現在登入走站台共用的 auth 流程，
// 所以這裡只負責把還存著舊書籤的人導回後台首頁。
//
// 用 beforeLoad + redirect 而不是元件裡的 <Navigate>：這條不需要任何權限狀態，
// 純粹是網址對映，在進元件之前就解決掉最省事——也不會閃一下空畫面。
export const Route = createFileRoute('/admin/login')({
  beforeLoad: () => {
    throw redirect({ to: '/admin', replace: true });
  },
});
