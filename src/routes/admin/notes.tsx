import { createFileRoute } from '@tanstack/react-router';

// 日記管理尚未實作。側欄有這個入口，所以路由要存在——沒有的話點進去會落到 404，
// 那比一個明說「開發中」的頁面更難懂。
export const Route = createFileRoute('/admin/notes')({
  component: () => (
    <div
      style={{
        padding: '2rem',
        color: 'white',
        background: '#1a202c',
        borderRadius: '8px',
        margin: '2rem',
      }}
    >
      <h2 style={{ borderBottom: '1px solid #333', paddingBottom: '1rem' }}>日記管理</h2>
      <p style={{ marginTop: '1rem' }}>此頁面功能正在開發中。</p>
    </div>
  ),
});
