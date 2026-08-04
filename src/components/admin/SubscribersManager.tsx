import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubscriberRow } from '@koimsurai/api-types';
import { adminSubscribersByStatusQueryOptions } from '@/data/adminData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, MailX, RefreshCw, Search, Download, Trash2, type LucideIcon } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { lookupOr } from '../../lib/tableLookup';

/** `GET /api/newsletter/subscribers` 的單列，型別由後端 Rust struct 生成（見 backend/SPECTA_PLAN.md）。 */
type Subscriber = SubscriberRow;

interface StatusConfigEntry { label: string; color: string; bg: string; border: string; icon: LucideIcon }

const STATUS_CONFIG: Record<string, StatusConfigEntry> = {
  active:       { label: '已訂閱',   color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', icon: Mail },
  unsubscribed: { label: '已退訂',   color: 'text-zinc-400',    bg: 'bg-zinc-400/10',    border: 'border-zinc-400/20',    icon: MailX },
};

export default function SubscribersManager() {
  const queryClient = useQueryClient();
  // 訂閱列表改由 TanStack Query 讀：active / unsubscribed 兩把（原 Promise.all 兩抓）。
  const { data: active = [], isPending: la } = useQuery(adminSubscribersByStatusQueryOptions('active'));
  const { data: unsubscribed = [], isPending: lu } = useQuery(adminSubscribersByStatusQueryOptions('unsubscribed'));
  const allSubscribers = useMemo<Record<string, Subscriber[]>>(() => ({ active, unsubscribed }), [active, unsubscribed]);
  const isLoading = la || lu;
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; sub: Subscriber | null }>({ open: false, sub: null });

  // 呼叫時才讀 token，不在 render 期讀：localStorage 是外部可變狀態，render 必須是純的
  //（react-hooks/purity）。順帶修掉一個實質問題——原本 token 在 render 當下就固定了，
  // session 中途重新登入會繼續帶舊的。
  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('koimsurai_user_token') ?? ''}`,
    'Content-Type': 'application/json',
  });
  // 退訂/刪除等 mutation 後重抓兩把（prefix invalidate）
  const invalidateSubs = () => queryClient.invalidateQueries({ queryKey: ['admin', 'subscribers'] });

  const visible = lookupOr(allSubscribers, statusFilter, []).filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.email.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q);
  });

  const handleUnsubscribe = async (sub: Subscriber) => {
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: sub.email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? '退訂失敗');
      }
      toast.success(`已將 ${sub.email} 標記為退訂`);
      void invalidateSubs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '退訂失敗');
    }
  };

  const exportCSV = () => {
    const rows = visible.map((s) => [
      s.email,
      s.name ?? '',
      s.status,
      s.subscribed_at ?? '',
      s.unsubscribed_at ?? '',
    ]);
    const csv = [
      ['email', 'name', 'status', 'subscribed_at', 'unsubscribed_at'],
      ...rows,
    ].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (s?: string | null) => {
    if (!s) return '-';
    const d = new Date(s);
    return d.toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">電子報訂閱</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理 Newsletter 訂閱者。新文章可以從文章編輯頁勾選「發佈時推送 Newsletter」自動寄送。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void invalidateSubs(); }}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            重新整理
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(STATUS_CONFIG).map(([status, config]) => {
          const count = lookupOr(allSubscribers, status, []).length;
          const Icon = config.icon;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-xl border ${config.border} ${config.bg} p-4 flex items-center gap-3 text-left transition-all ${
                statusFilter === status ? 'ring-1 ring-offset-2 ring-offset-background ring-violet-400/40' : 'opacity-70 hover:opacity-100'
              }`}
            >
              <div className={`p-2 rounded-lg ${config.bg}`}>
                <Icon className={`h-5 w-5 ${config.color}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{config.label}</p>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋 Email 或名字..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-muted-foreground">名字</th>
                <th className="text-left p-3 font-medium text-muted-foreground">訂閱時間</th>
                <th className="text-left p-3 font-medium text-muted-foreground">退訂時間</th>
                <th className="text-right p-3 font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" /> 載入中...
                </td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">
                  <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  {searchQuery ? '找不到符合的訂閱者' : (statusFilter === 'active' ? '尚無訂閱者' : '沒有退訂紀錄')}
                </td></tr>
              ) : (
                visible.map((s) => (
                  <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-mono text-xs">{s.email}</td>
                    <td className="p-3">{s.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 text-muted-foreground text-xs">{formatDate(s.subscribed_at)}</td>
                    <td className="p-3 text-muted-foreground text-xs">{formatDate(s.unsubscribed_at)}</td>
                    <td className="p-3 text-right">
                      {s.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-400/10 h-7 gap-1.5"
                          onClick={() => setDeleteDialog({ open: true, sub: s })}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 標記退訂
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, sub: deleteDialog.sub })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>標記為退訂?</AlertDialogTitle>
            <AlertDialogDescription>
              將 <span className="font-mono">{deleteDialog.sub?.email}</span> 標記為已退訂，未來不會再寄信給此地址。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-500 hover:bg-rose-600"
              onClick={() => { if (deleteDialog.sub) void handleUnsubscribe(deleteDialog.sub); setDeleteDialog({ open: false, sub: null }); }}
            >
              標記退訂
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
