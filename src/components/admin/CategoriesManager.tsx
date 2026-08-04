import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCategoryRow } from '@koimsurai/api-types';
import { adminCategoriesQueryOptions } from '@/data/adminData';
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
import { Plus, Pencil, Trash2, FolderOpen, GripVertical, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  short_description: string;
  // 顯示用譯名（name 仍是資料鍵：文章的 category 與前台篩選都比對它）
  name_en: string;
  name_ja: string;
  name_ko: string;
  name_zh_cn: string;
  description_en: string;
  description_ja: string;
  description_ko: string;
  description_zh_cn: string;
  short_description_en: string;
  short_description_ja: string;
  short_description_ko: string;
  short_description_zh_cn: string;
}

/** 表單裡「描述類」譯文欄位的型別（給 keyof 索引用）。 */
type TagLikeDesc = Pick<CategoryForm,
  'description_en' | 'description_ja' | 'description_ko' | 'description_zh_cn' |
  'short_description_en' | 'short_description_ja' | 'short_description_ko' | 'short_description_zh_cn'>;

/** 譯名欄位表：新增語系時只要改這裡（表單自動長出欄位）。 */
const LOCALE_NAME_FIELDS = [
  { key: 'name_en', label: 'English', placeholder: 'Tech Notes' },
  { key: 'name_ja', label: '日本語', placeholder: '技術ノート' },
  { key: 'name_ko', label: '한국어', placeholder: '기술 노트' },
  { key: 'name_zh_cn', label: '简体中文', placeholder: '技术笔记' },
] as const;

export default function CategoriesManager() {
  const queryClient = useQueryClient();
  // 分類列表改由 TanStack Query 讀（生成 AdminCategoryRow）；CRUD 後 invalidate 重抓。
  const { data: categories = [], isPending: isLoading } = useQuery(adminCategoriesQueryOptions);
  const invalidateCategories = () => queryClient.invalidateQueries({ queryKey: adminCategoriesQueryOptions.queryKey });
  const [editingCategory, setEditingCategory] = useState<AdminCategoryRow | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CategoryForm>({
    name: '',
    slug: '',
    description: '',
    short_description: '',
    name_en: '',
    name_ja: '',
    name_ko: '',
    name_zh_cn: '',
    description_en: '',
    description_ja: '',
    description_ko: '',
    description_zh_cn: '',
    short_description_en: '',
    short_description_ja: '',
    short_description_ko: '',
    short_description_zh_cn: '',
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const q = searchQuery.toLowerCase();
  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.slug.toLowerCase().includes(q)
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const url = editingCategory
        ? `/api/admin/categories/${editingCategory.id}`
        : '/api/admin/categories';
      const method = editingCategory ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success(editingCategory ? '分類已更新' : '分類已創建');
        setDialogOpen(false);
        resetForm();
        void invalidateCategories();
      } else {
        toast.error('操作失敗');
      }
    } catch (error) {
      console.error('保存分類失敗:', error);
      toast.error('保存失敗');
    }
  };

  const handleEdit = (category: AdminCategoryRow) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description ?? '',
      short_description: category.short_description ?? '',
      name_en: category.name_en ?? '',
      name_ja: category.name_ja ?? '',
      name_ko: category.name_ko ?? '',
      name_zh_cn: category.name_zh_cn ?? '',
      description_en: category.description_en ?? '',
      description_ja: category.description_ja ?? '',
      description_ko: category.description_ko ?? '',
      description_zh_cn: category.description_zh_cn ?? '',
      short_description_en: category.short_description_en ?? '',
      short_description_ja: category.short_description_ja ?? '',
      short_description_ko: category.short_description_ko ?? '',
      short_description_zh_cn: category.short_description_zh_cn ?? '',
    });
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const response = await fetch(`/api/admin/categories/${deleteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token ?? ''}` },
      });

      if (response.ok) {
        toast.success('分類已刪除');
        void invalidateCategories();
      } else {
        toast.error('刪除失敗');
      }
    } catch (error) {
      console.error('刪除分類失敗:', error);
      toast.error('刪除失敗');
    } finally {
      setDeleteId(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', slug: '', description: '', short_description: '', name_en: '', name_ja: '', name_ko: '', name_zh_cn: '', description_en: '', description_ja: '', description_ko: '', description_zh_cn: '', short_description_en: '', short_description_ja: '', short_description_ko: '', short_description_zh_cn: '' });
    setEditingCategory(null);
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
          <h1 className="text-lg font-medium text-foreground/90">分類管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            共 {categories.length} 個分類
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8 border-border/50 text-foreground/70 hover:bg-accent/40" onClick={resetForm}>
              <Plus className="size-3.5" />
              新增分類
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCategory ? '編輯分類' : '新增分類'}</DialogTitle>
              <DialogDescription>
                {editingCategory ? '修改分類資訊' : '創建新的文章分類'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { void handleSubmit(e); }}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">分類名稱</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="技術筆記"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">URL 別名</Label>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    placeholder="tech-notes"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">描述</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="關於技術的學習筆記"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="short_description">簡述（前台 tooltip 顯示）</Label>
                  <Input
                    id="short_description"
                    value={formData.short_description}
                    onChange={(e) => setFormData({ ...formData, short_description: e.target.value })}
                    placeholder="一句話描述此分類"
                  />
                </div>

                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground mb-1">多語系顯示名（選填）</p>
                  <p className="text-[11px] text-muted-foreground/60 mb-3">
                    只影響各語系頁面上的顯示；「分類名稱」仍是資料鍵（文章歸屬與篩選都用它）。留空該語系就顯示原名。
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

                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground mb-1">多語系簡述／描述（選填）</p>
                  <p className="text-[11px] text-muted-foreground/60 mb-3">
                    對應上方的「簡述」與「描述」，會顯示在各語系文章頁的分類 tooltip。留空該語系就顯示原文。
                  </p>
                  <div className="space-y-3">
                    {LOCALE_NAME_FIELDS.map(({ key, label }) => {
                      const shortKey = key.replace('name_', 'short_description_') as keyof TagLikeDesc;
                      const descKey = key.replace('name_', 'description_') as keyof TagLikeDesc;
                      return (
                        <div key={key} className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor={shortKey} className="text-xs">{label}・簡述</Label>
                            <Input
                              id={shortKey}
                              value={formData[shortKey]}
                              onChange={(e) => setFormData({ ...formData, [shortKey]: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={descKey} className="text-xs">{label}・描述</Label>
                            <Input
                              id={descKey}
                              value={formData[descKey]}
                              onChange={(e) => setFormData({ ...formData, [descKey]: e.target.value })}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit">
                  {editingCategory ? '更新' : '創建'}
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
        placeholder="搜尋分類..."
        className="bg-accent/20 border-border/40 text-foreground/80 text-sm h-9 placeholder:text-muted-foreground/40"
      />

      {/* Category list */}
      {filteredCategories.length > 0 ? (
        <div className="glass rounded-xl divide-y divide-border/20 overflow-hidden">
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-accent/15 transition-colors">
              <GripVertical className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab" />
              <div className="size-8 rounded-lg bg-accent/40 flex items-center justify-center shrink-0">
                <FolderOpen className="size-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground/80">{cat.name}</span>
                  {cat.slug && <span className="text-[11px] text-muted-foreground/50 font-mono">/{cat.slug}</span>}
                </div>
                {cat.description && (
                  <p className="text-[12px] text-muted-foreground/60 mt-0.5 truncate">{cat.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 shrink-0 mr-2">
                <FileText className="size-3" />
                {cat.post_count}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEdit(cat)}
                  className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground/70 hover:bg-accent/40 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => setDeleteId(cat.id)}
                  className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground/50">
          <FolderOpen className="size-12 opacity-20" />
          <p className="mt-4 text-sm">還沒有分類</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除這個分類嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作無法復原。分類將被永久刪除，但不會影響已分類的文章。
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
