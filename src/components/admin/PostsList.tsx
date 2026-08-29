import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPostFull } from '@koimsurai/api-types';
import { adminPostsQueryOptions } from '@/data/adminData';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Search, Pencil, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { postPath } from '../../lib/postPath';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** `GET /api/admin/posts` 的單列（型別由後端 Rust struct 生成）。 */
type PostItem = AdminPostFull;

export default function PostsList() {
  const queryClient = useQueryClient();
  // 文章列表改由 TanStack Query 讀（生成 AdminPostsResponse）；刪除後 invalidate 重抓。
  const { data, isPending: isLoading } = useQuery(adminPostsQueryOptions('limit=500'));
  const posts: PostItem[] = data?.posts ?? [];
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const response = await fetch(`/api/admin/posts/${deleteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });

      if (response.ok) {
        toast.success('文章已刪除');
        void queryClient.invalidateQueries({ queryKey: ['admin', 'posts'] });
      } else {
        toast.error('刪除失敗');
      }
    } catch (error) {
      console.error('刪除文章失敗:', error);
      toast.error('刪除失敗');
    } finally {
      setDeleteId(null);
    }
  };

  const statusLabels: Record<string, string> = {
    published: '已發佈',
    draft: '草稿',
    archived: '已封存',
  };

  const statusStyle: Record<string, string> = {
    published: 'text-foreground/50 bg-accent/50',
    draft: 'text-muted-foreground/70 bg-accent/25',
    archived: 'text-muted-foreground/50 bg-accent/20',
  };

  const filtered = posts.filter((p) => {
    if (filter === 'published' && p.status !== 'published') return false;
    if (filter === 'draft' && p.status !== 'draft') return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-transparent"></div>
          <p className="mt-4 text-muted-foreground">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground/90">文章管理</h1>
          <p className="text-sm text-muted-foreground mt-1">共 {posts.length} 篇文章</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 h-8 border-border/50 text-foreground/70 hover:bg-accent/40"
          asChild
        >
          <Link to="/admin/posts/create">
            <Plus className="size-3.5" />
            新增文章
          </Link>
        </Button>
      </div>

      {/* Filters + Search */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 shrink-0">
          {[
            { key: 'all', label: '全部' },
            { key: 'published', label: '已發佈' },
            { key: 'draft', label: '草稿' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[12px] px-2.5 py-1 rounded-lg transition-colors ${
                filter === f.key
                  ? 'bg-accent/60 text-foreground/80'
                  : 'text-muted-foreground/60 hover:text-foreground/60 hover:bg-accent/25'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋文章..."
            className="bg-accent/20 border-border/40 text-foreground/80 text-sm h-8 pl-8 placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* Posts table */}
      {filtered.length > 0 ? (
        <div className="glass rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/20 text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
                <th className="text-left px-4 py-2.5 font-medium">標題</th>
                <th className="text-left px-4 py-2.5 font-medium w-16">分類</th>
                <th className="text-center px-4 py-2.5 font-medium w-16">狀態</th>
                <th className="text-right px-4 py-2.5 font-medium w-24">日期</th>
                <th className="text-right px-4 py-2.5 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/15">
              {filtered.map((post) => (
                <tr key={post.id} className="group hover:bg-accent/15 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] text-muted-foreground/40 font-mono">{post.id}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div>
                      <span className="text-[13px] text-foreground/80 group-hover:text-foreground/90 transition-colors">
                        {post.title}
                      </span>
                      {post.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {post.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[10px] text-muted-foreground/35 font-mono">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[11px] text-muted-foreground/60">{post.category ?? '未分類'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${statusStyle[post.status] || 'text-muted-foreground bg-accent/20'}`}
                    >
                      {statusLabels[post.status] || post.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-[11px] text-muted-foreground/40">
                      {post.created_at ? format(new Date(post.created_at), 'yyyy-MM-dd') : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link
                        to="/admin/posts/edit/$id"
                        params={{ id: String(post.id) }}
                        className="size-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/40 transition-colors"
                      >
                        <Pencil className="size-3" />
                      </Link>
                      {/* 文章網址是 /blog/:id（posts 表沒有 slug 欄位） */}
                      <Link
                        to={postPath(post)}
                        target="_blank"
                        className="size-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/40 transition-colors"
                      >
                        <ExternalLink className="size-3" />
                      </Link>
                      <button
                        onClick={() => setDeleteId(post.id)}
                        className="size-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="glass rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground/50">
          <Search className="size-12 opacity-20" />
          <p className="mt-4 text-sm">還沒有文章</p>
          <Button
            variant="outline"
            className="mt-4 border-border/50 text-foreground/70 hover:bg-accent/40"
            size="sm"
            asChild
          >
            <Link to="/admin/posts/create">
              <Plus className="mr-2 size-3.5" />
              創建第一篇文章
            </Link>
          </Button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground/40">
        <span>
          顯示 {filtered.length} / {posts.length} 篇文章
        </span>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除這篇文章嗎？</AlertDialogTitle>
            <AlertDialogDescription>此操作無法復原。文章將被永久刪除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
