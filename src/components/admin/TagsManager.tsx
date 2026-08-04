import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminTagRow } from '@koimsurai/api-types';
import { adminTagsQueryOptions } from '@/data/adminData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Plus, X, Tag } from 'lucide-react';
import { toast } from 'sonner';

interface TagForm {
  name: string;
  slug: string;
  color: string;
  // 顯示用譯名（name 仍是資料鍵：文章的標籤關聯與前台篩選都比對它）
  name_en: string;
  name_ja: string;
  name_ko: string;
  name_zh_cn: string;
}

/** 譯名欄位表：新增語系時只要改這裡（表單自動長出欄位）。 */
const LOCALE_NAME_FIELDS = [
  { key: 'name_en', label: 'English', placeholder: 'React' },
  { key: 'name_ja', label: '日本語', placeholder: 'リアクト' },
  { key: 'name_ko', label: '한국어', placeholder: '리액트' },
  { key: 'name_zh_cn', label: '简体中文', placeholder: 'React' },
] as const;

export default function TagsManager() {
  const queryClient = useQueryClient();
  // 標籤列表改由 TanStack Query 讀（生成 AdminTagRow）；CRUD 後 invalidate 重抓。
  const { data: tags = [], isPending: isLoading } = useQuery(adminTagsQueryOptions);
  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: adminTagsQueryOptions.queryKey });
  const [editingTag, setEditingTag] = useState<AdminTagRow | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  // slug/color 是舊表單殘留欄位（後端 create_tag 只寫 name、列表也不回傳）→ 保留輸入但實為 inert。
  const [formData, setFormData] = useState<TagForm>({
    name: '',
    slug: '',
    color: '#7f5af0',
    name_en: '',
    name_ja: '',
    name_ko: '',
    name_zh_cn: '',
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTags = tags.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedTags = [...filteredTags].sort((a, b) => b.post_count - a.post_count);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const url = editingTag
        ? `/api/admin/tags/${editingTag.id}`
        : '/api/admin/tags';
      const method = editingTag ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success(editingTag ? '標籤已更新' : '標籤已創建');
        setDialogOpen(false);
        resetForm();
        void invalidateTags();
      } else {
        toast.error('操作失敗');
      }
    } catch (error) {
      console.error('保存標籤失敗:', error);
      toast.error('保存失敗');
    }
  };

  const handleEdit = (tag: AdminTagRow) => {
    setEditingTag(tag);
    // AdminTagRow 無 slug/color（後端不存不回）→ 編輯時走預設，與舊行為一致
    setFormData({
      name: tag.name,
      name_en: tag.name_en ?? '',
      name_ja: tag.name_ja ?? '',
      name_ko: tag.name_ko ?? '',
      name_zh_cn: tag.name_zh_cn ?? '',
      slug: '',
      color: '#7f5af0',
    });
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const response = await fetch(`/api/admin/tags/${deleteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token ?? ''}` },
      });

      if (response.ok) {
        toast.success('標籤已刪除');
        void invalidateTags();
      } else {
        toast.error('刪除失敗');
      }
    } catch (error) {
      console.error('刪除標籤失敗:', error);
      toast.error('刪除失敗');
    } finally {
      setDeleteId(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', slug: '', color: '#7f5af0', name_en: '', name_ja: '', name_ko: '', name_zh_cn: '' });
    setEditingTag(null);
  };

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
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground/90">標籤管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {tags.length} 個標籤
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8 border-border/50 text-foreground/70 hover:bg-accent/40" onClick={resetForm}>
              <Plus className="size-3.5" />
              新增標籤
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingTag ? '編輯標籤' : '新增標籤'}</DialogTitle>
              <DialogDescription>
                {editingTag ? '修改標籤資訊' : '創建新的文章標籤'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { void handleSubmit(e); }}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">標籤名稱</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="React"
                    required
                  />
                </div>

                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground mb-1">多語系顯示名（選填）</p>
                  <p className="text-[11px] text-muted-foreground/60 mb-3">
                    只影響各語系頁面上的顯示；「標籤名稱」仍是資料鍵（文章的標籤關聯與篩選都用它）。留空該語系就顯示原名。
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {LOCALE_NAME_FIELDS.map(({ key, label, placeholder }) => (
                      <div className="space-y-2" key={key}>
                        <Label htmlFor={key} className="text-xs">{label}</Label>
                        <Input
                          id={key}
                          value={formData[key]}
                          onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                          placeholder={placeholder}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">URL 別名</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    placeholder="react"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="color">顏色</Label>
                  <div className="flex gap-2">
                    <Input
                      id="color"
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-20 h-10"
                    />
                    <Input
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      placeholder="#7f5af0"
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit">
                  {editingTag ? '更新' : '創建'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <Input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜尋標籤..."
        className="bg-accent/20 border-border/40 text-foreground/80 text-sm h-9 placeholder:text-muted-foreground/40"
      />

      {/* Tags cloud */}
      {sortedTags.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="flex flex-wrap gap-2">
            {sortedTags.map((tag) => {
              const count = tag.post_count;
              const sizeClass = count >= 10
                ? 'text-sm px-3 py-1.5'
                : count >= 5
                  ? 'text-[13px] px-2.5 py-1'
                  : 'text-[12px] px-2 py-0.5';

              return (
                <span
                  key={tag.id}
                  className={`group inline-flex items-center gap-1.5 rounded-lg border border-border/40 text-foreground/60 hover:text-foreground/80 hover:border-border/60 transition-colors cursor-default ${sizeClass}`}
                >
                  <span>{tag.name}</span>
                  <span className="text-muted-foreground/40 text-[10px]">{count}</span>
                  <button
                    onClick={() => setDeleteId(tag.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags table */}
      {sortedTags.length > 0 ? (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <h2 className="text-[13px] font-medium text-foreground/80">全部標籤</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/20 text-[11px] text-muted-foreground/60 uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">名稱</th>
                <th className="text-right px-4 py-2 font-medium">文章數</th>
                <th className="text-right px-4 py-2 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/15">
              {sortedTags.map((tag) => (
                <tr key={tag.id} className="group hover:bg-accent/15 transition-colors">
                  {/* 這格有可見文字（標籤名稱），但巢狀在第 3 層，超過規則預設只看 2 層的 depth → 誤報 */}
                  {/* eslint-disable-next-line jsx-a11y/control-has-associated-label */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-foreground/70 font-mono">{tag.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="text-[12px] text-muted-foreground/60">{tag.post_count}</span>
                  </td>
                  {/* 這格有可見文字（「編輯」「刪除」按鈕文字），但巢狀在第 3 層，超過規則預設只看 2 層的 depth → 誤報 */}
                  {/* eslint-disable-next-line jsx-a11y/control-has-associated-label */}
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(tag)}
                        className="text-[11px] text-muted-foreground hover:text-foreground/70 transition-all px-1.5 py-0.5 rounded hover:bg-accent/40"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => setDeleteId(tag.id)}
                        className="text-[11px] text-muted-foreground hover:text-destructive transition-all px-1.5 py-0.5 rounded hover:bg-destructive/10"
                      >
                        刪除
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
          <Tag className="size-12 opacity-20" />
          <p className="mt-4 text-sm">還沒有標籤</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除這個標籤嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作無法復原。標籤將被永久刪除，但不會影響已標記的文章。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
