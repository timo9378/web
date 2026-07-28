import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminUsersQueryOptions } from '../../adminData';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, RefreshCw, Shield, ShieldCheck, Crown, Search, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth';

import type { AdminUserRow } from '@koimsurai/api-types';

// 型別來源＝Rust struct（specta 生成）；原手寫 interface 已與 API 漂移（avatar vs avatar_url、id 型別）
type AdminUser = AdminUserRow;

interface RoleConfig { label: string; color: string; bg: string; border: string; icon: LucideIcon }

const ROLE_CONFIG: Record<string, RoleConfig> = {
  OWNER: { label: 'Owner', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', icon: Crown },
  ADMIN: { label: 'Admin', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20', icon: ShieldCheck },
  USER: { label: 'User', color: 'text-zinc-400', bg: 'bg-zinc-400/10', border: 'border-zinc-400/20', icon: Shield },
};

export default function UsersManager() {
  const { user: currentUser, isOwner } = useAuth();
  const queryClient = useQueryClient();
  // 用戶列表改由 TanStack Query 讀（生成 AdminUserRow）；改角色後 invalidate 重抓。
  const { data: users = [], isPending: isLoading } = useQuery(adminUsersQueryOptions);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleChangeDialog, setRoleChangeDialog] = useState<{ open: boolean; user: AdminUser | null; newRole: string }>({ open: false, user: null, newRole: '' });

  const token = localStorage.getItem('koimsurai_user_token');
  const headers = { 'Authorization': `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' };

  const handleRoleChange = async () => {
    const { user: targetUser, newRole } = roleChangeDialog;
    if (!targetUser || !newRole) return;

    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        toast.success(`已將 ${targetUser.display_name ?? ''} 的角色更改為 ${ROLE_CONFIG[newRole]?.label ?? newRole}`);
        void queryClient.invalidateQueries({ queryKey: adminUsersQueryOptions.queryKey });
      } else {
        const data = await res.json() as { error?: string };
        toast.error(data.error ?? '更改角色失敗');
      }
    } catch {
      toast.error('更改角色失敗');
    } finally {
      setRoleChangeDialog({ open: false, user: null, newRole: '' });
    }
  };

  const filteredUsers = users.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.display_name ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.provider ?? '').toLowerCase().includes(q)
    );
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用戶管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理所有註冊用戶及其角色權限</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void queryClient.invalidateQueries({ queryKey: adminUsersQueryOptions.queryKey }); }}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          重新整理
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.entries(ROLE_CONFIG).map(([role, config]) => {
          const count = users.filter((u) => u.role === role).length;
          const Icon = config.icon;
          return (
            <div
              key={role}
              className={`rounded-xl border ${config.border} ${config.bg} p-4 flex items-center gap-3`}
            >
              <div className={`p-2 rounded-lg ${config.bg}`}>
                <Icon className={`h-5 w-5 ${config.color}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{config.label}</p>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋用戶名稱、Email、Provider..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Users Table */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">用戶</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Provider</th>
                <th className="text-left p-3 font-medium text-muted-foreground">角色</th>
                <th className="text-left p-3 font-medium text-muted-foreground">註冊時間</th>
                {isOwner && <th className="text-left p-3 font-medium text-muted-foreground">操作</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={isOwner ? 6 : 5} className="text-center py-12 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    載入中...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 6 : 5} className="text-center py-12 text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    {searchQuery ? '找不到符合的用戶' : '尚無用戶'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const roleConfig = ROLE_CONFIG[u.role ?? 'USER'] || ROLE_CONFIG.USER;
                  const RoleIcon = roleConfig.icon;
                  const isSelf = currentUser && (String(currentUser.id) === String(u.id) || currentUser.email === u.email);

                  return (
                    <tr key={u.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                      {/* User */}
                      <td className="p-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0">
                            {u.avatar_url && <AvatarImage src={u.avatar_url} alt={u.display_name ?? undefined} />}
                            <AvatarFallback className="bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-700/60">
                              {(u.display_name ?? '?').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium truncate max-w-[150px]">
                            {u.display_name ?? '-'}
                            {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(你)</span>}
                          </span>
                        </div>
                      </td>
                      {/* Email */}
                      <td className="p-3 text-muted-foreground truncate max-w-[200px]">{u.email ?? '-'}</td>
                      {/* Provider */}
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                          {u.provider === 'google' ? '🔵 Google' : u.provider === 'github' ? '⚫ GitHub' : (u.provider ?? '-')}
                        </span>
                      </td>
                      {/* Role */}
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${roleConfig.bg} ${roleConfig.color} border ${roleConfig.border}`}>
                          <RoleIcon className="h-3 w-3" />
                          {roleConfig.label}
                        </span>
                      </td>
                      {/* Created At */}
                      <td className="p-3 text-muted-foreground text-xs">{formatDate(u.created_at ?? undefined)}</td>
                      {/* Actions */}
                      {isOwner && (
                        <td className="p-3">
                          {isSelf ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : u.role === 'OWNER' ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Select
                              value={u.role ?? 'USER'}
                              onValueChange={(newRole) => {
                                if (newRole !== u.role) {
                                  setRoleChangeDialog({ open: true, user: u, newRole });
                                }
                              }}
                            >
                              <SelectTrigger className="w-[110px] h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="USER">User</SelectItem>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Total */}
      <p className="text-xs text-muted-foreground text-right">
        共 {filteredUsers.length} 位用戶{searchQuery && ` (搜尋結果，共 ${users.length} 位)`}
      </p>

      {/* Role Change Confirmation Dialog */}
      <AlertDialog
        open={roleChangeDialog.open}
        onOpenChange={(open) => { if (!open) setRoleChangeDialog({ open: false, user: null, newRole: '' }); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認更改角色</AlertDialogTitle>
            <AlertDialogDescription>
              確定要將 <strong>{roleChangeDialog.user?.display_name}</strong> 的角色從{' '}
              <strong>{roleChangeDialog.user ? ROLE_CONFIG[roleChangeDialog.user.role ?? 'USER']?.label : ''}</strong> 更改為{' '}
              <strong>{ROLE_CONFIG[roleChangeDialog.newRole]?.label}</strong> 嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleRoleChange(); }}>確認更改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
