import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminCommentsQueryOptions, adminBlacklistQueryOptions, adminKeywordFiltersQueryOptions,
} from '../../adminData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  MessageSquare, Check, X, Trash2, Ban,
  Search, RefreshCw, Reply, Pencil, Filter, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCommentRow } from '@koimsurai/api-types';

/** 型別由後端 Rust struct 生成（見 backend/SPECTA_PLAN.md）；blacklist/keywords 由 query 推導。 */
type Comment = AdminCommentRow;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: '待審核', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' },
  approved: { label: '已批准', color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20' },
  spam: { label: '垃圾訊息', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
  trash: { label: '垃圾桶', color: 'text-zinc-500', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
};

export default function CommentsManager() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  // Dialogs
  const [replyDialog, setReplyDialog] = useState<{ open: boolean; comment: Comment | null }>({ open: false, comment: null });
  const [replyText, setReplyText] = useState('');
  const [editDialog, setEditDialog] = useState<{ open: boolean; comment: Comment | null }>({ open: false, comment: null });
  const [editText, setEditText] = useState('');
  const [deleteId, setDeleteId] = useState<number | string | null>(null);

  // Blacklist & Keyword tabs
  const [activeTab, setActiveTab] = useState('comments'); // comments | blacklist | keywords
  const [newBlacklistIp, setNewBlacklistIp] = useState('');
  const [newBlacklistReason, setNewBlacklistReason] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newKeywordAction, setNewKeywordAction] = useState('spam');

  // 呼叫時才讀 token，不在 render 期讀：localStorage 是外部可變狀態，render 必須是純的
  //（react-hooks/purity）。順帶修掉一個實質問題——原本 token 在 render 當下就固定了，
  // session 中途重新登入會繼續帶舊的。
  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('koimsurai_user_token') ?? ''}`,
    'Content-Type': 'application/json',
  });

  // 留言列表改由 TanStack Query 讀（分頁/篩選進 queryKey），blacklist/keywords 依 activeTab 才抓。
  const commentsQuery = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (searchQuery) params.set('search', searchQuery);
    return params.toString();
  }, [page, statusFilter, searchQuery]);
  const { data: commentsData, isPending: isLoading } = useQuery(adminCommentsQueryOptions(commentsQuery));
  const comments: Comment[] = commentsData?.comments ?? [];
  const counts = commentsData?.counts ?? { pending: 0, approved: 0, spam: 0, trash: 0 };
  const total = commentsData?.total ?? 0;

  const { data: blacklist = [] } = useQuery({ ...adminBlacklistQueryOptions, enabled: activeTab === 'blacklist' });
  const { data: keywordFilters = [] } = useQuery({ ...adminKeywordFiltersQueryOptions, enabled: activeTab === 'keywords' });

  const invalidateComments = () => queryClient.invalidateQueries({ queryKey: ['admin', 'comments'] });
  const invalidateBlacklist = () => queryClient.invalidateQueries({ queryKey: adminBlacklistQueryOptions.queryKey });
  const invalidateKeywords = () => queryClient.invalidateQueries({ queryKey: adminKeywordFiltersQueryOptions.queryKey });

  // ── Actions ──
  const updateStatus = async (id: number | string, status: string) => {
    try {
      const res = await fetch(`/api/admin/comments/${id}/status`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status }),
      });
      if (res.ok) { toast.success(STATUS_CONFIG[status].label); void invalidateComments(); }
    } catch { toast.error('操作失敗'); }
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    try {
      const res = await fetch(`/api/admin/comments/${replyDialog.comment?.id}/reply`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ content: replyText }),
      });
      if (res.ok) { toast.success('回覆成功'); setReplyDialog({ open: false, comment: null }); setReplyText(''); void invalidateComments(); }
    } catch { toast.error('回覆失敗'); }
  };

  const handleEdit = async () => {
    if (!editText.trim()) return;
    try {
      const res = await fetch(`/api/admin/comments/${editDialog.comment?.id}`, {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify({ content: editText }),
      });
      if (res.ok) { toast.success('已修改'); setEditDialog({ open: false, comment: null }); void invalidateComments(); }
    } catch { toast.error('修改失敗'); }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/admin/comments/${deleteId}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast.success('已永久刪除'); setDeleteId(null); void invalidateComments(); }
    } catch { toast.error('刪除失敗'); }
  };

  const blockIp = async (ip: string) => {
    try {
      const res = await fetch('/api/admin/blacklist', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ ip, reason: '來自留言管理封鎖' }),
      });
      if (res.ok) { toast.success(`已封鎖 IP: ${ip}`); }
    } catch { toast.error('封鎖失敗'); }
  };

  const addBlacklist = async () => {
    if (!newBlacklistIp.trim()) return;
    try {
      const res = await fetch('/api/admin/blacklist', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ ip: newBlacklistIp, reason: newBlacklistReason }),
      });
      if (res.ok) { toast.success('已加入黑名單'); setNewBlacklistIp(''); setNewBlacklistReason(''); void invalidateBlacklist(); }
    } catch { toast.error('操作失敗'); }
  };

  const removeBlacklist = async (id: number | string) => {
    try {
      const res = await fetch(`/api/admin/blacklist/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast.success('已移除'); void invalidateBlacklist(); }
    } catch { toast.error('操作失敗'); }
  };

  const addKeyword = async () => {
    if (!newKeyword.trim()) return;
    try {
      const res = await fetch('/api/admin/keyword-filters', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ keyword: newKeyword, action: newKeywordAction }),
      });
      if (res.ok) { toast.success('已新增過濾詞'); setNewKeyword(''); void invalidateKeywords(); }
    } catch { toast.error('操作失敗'); }
  };

  const removeKeyword = async (id: number | string) => {
    try {
      const res = await fetch(`/api/admin/keyword-filters/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) { toast.success('已移除'); void invalidateKeywords(); }
    } catch { toast.error('操作失敗'); }
  };

  const formatDate = (d: string) => new Date(d).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground/90 flex items-center gap-2">
            <MessageSquare className="size-5" /> 留言管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">審核、回覆和管理所有留言</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void invalidateComments(); }} className="gap-1.5">
          <RefreshCw className="size-3.5" /> 重新整理
        </Button>
      </div>

      {/* ── Tab Switcher ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-accent/30 w-fit">
        {[
          { id: 'comments', label: '留言列表', icon: MessageSquare },
          { id: 'blacklist', label: 'IP 黑名單', icon: Ban },
          { id: 'keywords', label: '關鍵字過濾', icon: Filter },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground/70'
            }`}>
            <tab.icon className="size-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════ Comments Tab ═══════ */}
      {activeTab === 'comments' && (
        <>
          {/* Status pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => { setStatusFilter('all'); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === 'all' ? 'border-foreground/20 text-foreground bg-accent/50' : 'border-border/40 text-muted-foreground hover:text-foreground/70'
              }`}>
              全部 <span className="ml-1 opacity-60">{totalAll}</span>
            </button>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button key={key} onClick={() => { setStatusFilter(key); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === key ? `${cfg.border} ${cfg.color} ${cfg.bg}` : 'border-border/40 text-muted-foreground hover:text-foreground/70'
                }`}>
                {cfg.label} <span className="ml-1 opacity-60">{(counts as Record<string, number>)[key] || 0}</span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input placeholder="搜尋留言..." value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                  className="pl-8 h-8 w-52 text-xs" />
              </div>
            </div>
          </div>

          {/* Comments List */}
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">載入中...</div>
          ) : comments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {searchQuery ? '找不到匹配的留言' : '目前沒有留言'}
            </div>
          ) : (
            <div className="space-y-2">
              {comments.map(c => {
                const cfg = STATUS_CONFIG[c.status ?? 'pending'] || STATUS_CONFIG.pending;
                return (
                  <div key={c.id} className="group rounded-lg border border-border/40 bg-card/50 hover:bg-accent/20 transition-colors">
                    <div className="p-4">
                      {/* Top row: author + meta */}
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="size-7 rounded-full bg-accent/60 flex items-center justify-center text-xs font-semibold text-foreground/80 shrink-0">
                            {c.author.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground/90 truncate">{c.author}</span>
                              {c.is_admin ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">站長</span>
                              ) : null}
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${cfg.bg} ${cfg.color} border ${cfg.border}`}>{cfg.label}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                              <span>{formatDate(c.created_at)}</span>
                              {c.ip && <span>· IP {c.ip}</span>}
                              {c.email && <span>· {c.email}</span>}
                            </div>
                          </div>
                        </div>
                        {c.post_title && (
                          <a href={`/blog/${c.post_id}`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/70 shrink-0 transition-colors">
                            <ExternalLink className="size-3" /> {c.post_title.substring(0, 20)}{c.post_title.length > 20 ? '...' : ''}
                          </a>
                        )}
                      </div>

                      {/* Content */}
                      <p className="text-sm text-foreground/70 leading-relaxed mb-3 pl-9">
                        {c.content.length > 200 ? c.content.substring(0, 200) + '...' : c.content}
                      </p>

                      {/* Quick Actions */}
                      <div className="flex items-center gap-1 pl-9 opacity-0 group-hover:opacity-100 transition-opacity">
                        {c.status !== 'approved' && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-green-400 hover:text-green-300 hover:bg-green-400/10"
                            onClick={() => { void updateStatus(c.id, 'approved'); }}>
                            <Check className="size-3" /> 批准
                          </Button>
                        )}
                        {c.status !== 'spam' && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                            onClick={() => { void updateStatus(c.id, 'spam'); }}>
                            <AlertTriangle className="size-3" /> 垃圾
                          </Button>
                        )}
                        {c.status !== 'trash' && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-400/10"
                            onClick={() => { void updateStatus(c.id, 'trash'); }}>
                            <Trash2 className="size-3" /> 丟棄
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-purple-400 hover:text-purple-300 hover:bg-purple-400/10"
                          onClick={() => { setReplyDialog({ open: true, comment: c }); setReplyText(''); }}>
                          <Reply className="size-3" /> 回覆
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10"
                          onClick={() => { setEditDialog({ open: true, comment: c }); setEditText(c.content); }}>
                          <Pencil className="size-3" /> 編輯
                        </Button>
                        {c.ip && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-orange-400 hover:text-orange-300 hover:bg-orange-400/10"
                            onClick={() => { if (c.ip) void blockIp(c.ip); }}>
                            <Ban className="size-3" /> 封鎖 IP
                          </Button>
                        )}
                        {c.status === 'trash' && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => setDeleteId(c.id)}>
                            <X className="size-3" /> 永久刪除
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
              <span className="text-xs text-muted-foreground flex items-center">第 {page} 頁 · 共 {total} 條</span>
              <Button variant="outline" size="sm" disabled={comments.length < 50} onClick={() => setPage(p => p + 1)}>下一頁</Button>
            </div>
          )}
        </>
      )}

      {/* ═══════ Blacklist Tab ═══════ */}
      {activeTab === 'blacklist' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="IP 位址" value={newBlacklistIp} onChange={e => setNewBlacklistIp(e.target.value)} className="h-8 text-xs w-40" />
            <Input placeholder="原因（選填）" value={newBlacklistReason} onChange={e => setNewBlacklistReason(e.target.value)} className="h-8 text-xs flex-1" />
            <Button size="sm" onClick={() => { void addBlacklist(); }} className="h-8 text-xs gap-1"><Ban className="size-3" /> 新增</Button>
          </div>
          {blacklist.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">黑名單是空的</p>
          ) : (
            <div className="space-y-1">
              {blacklist.map(b => (
                <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-card/50">
                  <div>
                    <span className="text-sm font-mono text-foreground/80">{b.ip}</span>
                    {b.reason && <span className="text-xs text-muted-foreground ml-3">{b.reason}</span>}
                    <span className="text-[11px] text-muted-foreground ml-3">{formatDate(b.created_at)}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300"
                    onClick={() => { void removeBlacklist(b.id); }}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ Keywords Tab ═══════ */}
      {activeTab === 'keywords' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="關鍵字" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} className="h-8 text-xs flex-1" />
            <select value={newKeywordAction} onChange={e => setNewKeywordAction(e.target.value)}
              className="h-8 text-xs rounded-md border border-border/40 bg-transparent text-foreground/80 px-2">
              <option value="spam">標記為垃圾</option>
              <option value="reject">直接拒絕</option>
            </select>
            <Button size="sm" onClick={() => { void addKeyword(); }} className="h-8 text-xs gap-1"><Filter className="size-3" /> 新增</Button>
          </div>
          {keywordFilters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">尚無過濾關鍵字</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {keywordFilters.map(f => (
                <div key={f.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
                  f.action === 'reject' ? 'border-red-500/30 text-red-400 bg-red-500/10' : 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10'
                }`}>
                  <span>{f.keyword}</span>
                  <span className="opacity-50">({f.action === 'reject' ? '拒絕' : '垃圾'})</span>
                  <button onClick={() => { void removeKeyword(f.id); }} className="ml-0.5 hover:text-foreground transition-colors">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════ Reply Dialog ═══════ */}
      <Dialog open={replyDialog.open} onOpenChange={o => setReplyDialog({ open: o, comment: replyDialog.comment })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>回覆留言</DialogTitle>
            <DialogDescription>
              回覆 <strong>{replyDialog.comment?.author}</strong> 的留言，將以「站長」身分顯示並附帶徽章。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-accent/30 p-3 rounded-lg">
              「{replyDialog.comment?.content.substring(0, 100)}...」
            </div>
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="輸入回覆內容..."
              className="w-full min-h-[100px] rounded-lg border border-border/40 bg-transparent p-3 text-sm text-foreground/90 resize-none outline-none focus:border-purple-500/40" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyDialog({ open: false, comment: null })}>取消</Button>
            <Button onClick={() => { void handleReply(); }}>發送回覆</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════ Edit Dialog ═══════ */}
      <Dialog open={editDialog.open} onOpenChange={o => setEditDialog({ open: o, comment: editDialog.comment })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>編輯留言</DialogTitle>
            <DialogDescription>修改留言內容，修改後讀者端將看到更新後的版本。</DialogDescription>
          </DialogHeader>
          <textarea value={editText} onChange={e => setEditText(e.target.value)}
            className="w-full min-h-[120px] rounded-lg border border-border/40 bg-transparent p-3 text-sm text-foreground/90 resize-none outline-none focus:border-blue-500/40" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, comment: null })}>取消</Button>
            <Button onClick={() => { void handleEdit(); }}>儲存修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════ Delete Confirm ═══════ */}
      <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久刪除留言？</AlertDialogTitle>
            <AlertDialogDescription>此操作無法撤銷，留言將從資料庫中完全刪除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleDelete(); }} className="bg-red-600 hover:bg-red-700">永久刪除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
