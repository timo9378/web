import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookRow } from '@koimsurai/api-types';
import { adminBooksQueryOptions } from '../../adminData';
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
import { Plus, Pencil, BookOpen, Search, Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { type FormEvent } from 'react';

/** `GET /api/books` 的單本，型別由後端 Rust struct 生成（見 backend/SPECTA_PLAN.md）。 */
type Book = BookRow;

interface BookFormData {
  isbn: string;
  title: string;
  authors: string;
  publisher: string;
  published_date: string;
  description: string;
  cover_url: string;
  page_count: number | string;
  language: string;
  categories: string;
  reading_status: string;
  rating: number | null;
  personal_notes: string;
}

export default function BooksManager() {
  const queryClient = useQueryClient();
  // 書籍列表改由 TanStack Query 讀（生成 BookRow）；CRUD 後 invalidate 重抓。
  const { data: books = [], isPending: isLoading } = useQuery(adminBooksQueryOptions);
  const invalidateBooks = () => queryClient.invalidateQueries({ queryKey: adminBooksQueryOptions.queryKey });
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [deleteId, setDeleteId] = useState<number | string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Book[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [formData, setFormData] = useState<BookFormData>({
    isbn: '',
    title: '',
    authors: '',
    publisher: '',
    published_date: '',
    description: '',
    cover_url: '',
    page_count: '',
    language: '',
    categories: '',
    reading_status: 'to-read',
    rating: null,
    personal_notes: '',
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredBooks = books.filter(book => {
    if (filterStatus !== 'all' && book.reading_status !== filterStatus) return false;
    const query = localSearchQuery.toLowerCase();
    return (
      book.title.toLowerCase().includes(query) ||
      (book.authors?.toLowerCase().includes(query) ?? false) ||
      (book.isbn?.toLowerCase().includes(query) ?? false)
    );
  });

  const statusCounts: Record<string, number> = {
    all: books.length,
    'to-read': books.filter(b => b.reading_status === 'to-read').length,
    'reading': books.filter(b => b.reading_status === 'reading').length,
    'read': books.filter(b => b.reading_status === 'read').length,
  };

  const statusConfig: Record<string, string> = {
    'to-read': 'text-muted-foreground/60 bg-accent/25',
    'reading': 'text-foreground/70 bg-accent/60',
    'read': 'text-foreground/50 bg-accent/50',
  };

  // 搜尋外部書籍 (Google Books API)
  const searchExternalBooks = async () => {
    if (!searchQuery.trim()) {
      toast.error('請輸入 ISBN 或書名');
      return;
    }
    
    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/books/search/external?query=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json() as { message?: string; books?: Book[] };
      
      if (data.message === 'success' && data.books) {
        setSearchResults(data.books);
        if (data.books.length === 0) {
          toast.info('未找到相關書籍');
        } else {
          toast.success(`找到 ${data.books.length} 本書籍`);
        }
      } else {
        toast.error('搜尋失敗');
      }
    } catch (error) {
      console.error('搜尋書籍失敗:', error);
      toast.error('搜尋失敗,請稍後再試');
    } finally {
      setIsSearching(false);
    }
  };

  // 從搜尋結果選擇書籍
  const handleSelectFromSearch = (book: Book) => {
    setFormData({
      isbn: book.isbn ?? '',
      title: book.title || '',
      authors: book.authors ?? '',
      publisher: book.publisher ?? '',
      published_date: book.published_date ?? '',
      description: book.description ?? '',
      cover_url: book.cover_url ?? '',
      page_count: book.page_count ?? '',
      language: book.language ?? '',
      categories: book.categories ?? '',
      reading_status: 'to-read',
      rating: null,
      personal_notes: '',
    });
    setSearchResults([]);
    setSearchQuery('');
    toast.success('已自動填入書籍資訊');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const url = editingBook 
        ? `/api/books/${editingBook.id}`
        : '/api/books';
      const method = editingBook ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success(editingBook ? '書籍已更新' : '書籍已新增');
        setDialogOpen(false);
        resetForm();
        void invalidateBooks();
      } else {
        toast.error('操作失敗');
      }
    } catch (error) {
      console.error('保存書籍失敗:', error);
      toast.error('保存失敗');
    }
  };

  const handleEdit = (book: Book) => {
    setEditingBook(book);
    setFormData({
      isbn: book.isbn ?? '',
      title: book.title || '',
      authors: book.authors ?? '',
      publisher: book.publisher ?? '',
      published_date: book.published_date ?? '',
      description: book.description ?? '',
      cover_url: book.cover_url ?? '',
      page_count: book.page_count ?? '',
      language: book.language ?? '',
      categories: book.categories ?? '',
      reading_status: book.reading_status ?? 'to-read',
      rating: book.rating ?? null,
      personal_notes: book.personal_notes ?? '',
    });
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const response = await fetch(`/api/books/${deleteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        toast.success('書籍已刪除');
        void invalidateBooks();
      } else {
        toast.error('刪除失敗');
      }
    } catch (error) {
      console.error('刪除書籍失敗:', error);
      toast.error('刪除失敗');
    } finally {
      setDeleteId(null);
    }
  };

  const resetForm = () => {
    setFormData({
      isbn: '',
      title: '',
      authors: '',
      publisher: '',
      published_date: '',
      description: '',
      cover_url: '',
      page_count: '',
      language: '',
      categories: '',
      reading_status: 'to-read',
      rating: null,
      personal_notes: '',
    });
    setEditingBook(null);
    setSearchResults([]);
    setSearchQuery('');
  };

  const statusLabels: Record<string, string> = {
    'to-read': '想讀',
    'reading': '閱讀中',
    'read': '已完成',
  };

  const renderStars = (rating: number | string | null) => {
    const numRating = Math.round(parseFloat(String(rating ?? 0)) || 0);
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={`size-3 ${i < numRating ? 'text-foreground/50 fill-foreground/50' : 'text-muted-foreground/20'}`}
          />
        ))}
      </div>
    );
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground/90">書籍管理</h1>
          <p className="text-sm text-muted-foreground mt-1">閱讀紀錄與書評管理</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8 border-border/50 text-foreground/70 hover:bg-accent/40" onClick={resetForm}>
              <Plus className="size-3.5" />
              新增書籍
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {editingBook ? '編輯書籍' : '新增書籍'}
              </DialogTitle>
              <DialogDescription>
                {editingBook ? '修改書籍資訊' : '從 ISBN 或書名搜尋,或手動輸入書籍資訊'}
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={(e) => { void handleSubmit(e); }}>
              {/* 內容滾動區域 */}
              <div className="max-h-[65vh] overflow-y-auto pr-2 space-y-4">
                {/* ISBN/書名搜尋區塊 */}
                {!editingBook && (
              <div className="space-y-3 pb-4 border-b border-zinc-800/50">
                <Label className="text-sm font-medium">📚 快速搜尋 (Google Books + OpenLibrary)</Label>
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); void searchExternalBooks(); } }}
                    placeholder="輸入 ISBN 或書名搜尋..."
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={() => { void searchExternalBooks(); }}
                    disabled={isSearching || !searchQuery.trim()}
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        搜尋中...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        搜尋
                      </>
                    )}
                  </Button>
                </div>

                {/* 搜尋結果 */}
                {searchResults.length > 0 && (
                  <div className="max-h-[300px] overflow-y-auto space-y-2 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium mb-2">搜尋結果 ({searchResults.length}):</p>
                    {searchResults.map((book) => (
                      <div
                        key={book.isbn}
                        className="flex gap-3 p-3 bg-background rounded-lg hover:bg-accent cursor-pointer transition-colors"
                        onClick={() => handleSelectFromSearch(book)}
                      >
                        {book.cover_url && (
                          <img
                            src={book.cover_url}
                            alt={book.title}
                            className="w-12 h-16 object-cover rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">{book.title}</h4>
                          {book.authors && (
                            <p className="text-xs text-muted-foreground">{book.authors}</p>
                          )}
                          {book.isbn && (
                            <p className="text-xs text-muted-foreground">ISBN: {book.isbn}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

                {/* 表單內容 */}
                <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="isbn">ISBN</Label>
                    <Input
                      id="isbn"
                      value={formData.isbn}
                      onChange={(e) => setFormData({ ...formData, isbn: e.target.value })}
                      placeholder="9789864060313"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="language">語言</Label>
                    <Input
                      id="language"
                      value={formData.language}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      placeholder="zh-TW"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">書名 *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="原子習慣"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="authors">作者</Label>
                  <Input
                    id="authors"
                    value={formData.authors}
                    onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                    placeholder="詹姆斯·克利爾"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="publisher">出版社</Label>
                    <Input
                      id="publisher"
                      value={formData.publisher}
                      onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                      placeholder="方智出版"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="published_date">出版日期</Label>
                    <Input
                      id="published_date"
                      type="date"
                      value={formData.published_date}
                      onChange={(e) => setFormData({ ...formData, published_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="page_count">頁數</Label>
                    <Input
                      id="page_count"
                      type="number"
                      value={formData.page_count}
                      onChange={(e) => setFormData({ ...formData, page_count: e.target.value })}
                      placeholder="320"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="categories">分類</Label>
                    <Input
                      id="categories"
                      value={formData.categories}
                      onChange={(e) => setFormData({ ...formData, categories: e.target.value })}
                      placeholder="自我成長"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cover_url">封面圖片網址</Label>
                  <Input
                    id="cover_url"
                    value={formData.cover_url}
                    onChange={(e) => setFormData({ ...formData, cover_url: e.target.value })}
                    placeholder="https://example.com/cover.jpg"
                  />
                  {formData.cover_url && (
                    <div className="mt-2 rounded-lg overflow-hidden border max-w-[200px]">
                      <img src={formData.cover_url} alt="封面預覽" className="w-full h-auto" />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">描述</Label>
                  <textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="書籍簡介..."
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reading_status">閱讀狀態</Label>
                    <select
                      id="reading_status"
                      value={formData.reading_status}
                      onChange={(e) => setFormData({ ...formData, reading_status: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="to-read">想讀</option>
                      <option value="reading">閱讀中</option>
                      <option value="read">已完成</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rating">評分 (0-5)</Label>
                    <Input
                      id="rating"
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={formData.rating ?? ''}
                      onChange={(e) => setFormData({ ...formData, rating: e.target.value ? parseFloat(e.target.value) : null })}
                      placeholder="5"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="personal_notes">個人筆記</Label>
                  <textarea
                    id="personal_notes"
                    value={formData.personal_notes}
                    onChange={(e) => setFormData({ ...formData, personal_notes: e.target.value })}
                    placeholder="分享您的閱讀心得和筆記..."
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                </div>
                </div>
              </div>
              {/* 關閉滾動區域 div */}
              
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit">
                  {editingBook ? '更新' : '新增'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1">
        {[{ key: 'all', label: '全部' }, { key: 'read', label: '已完成' }, { key: 'reading', label: '閱讀中' }, { key: 'to-read', label: '想讀' }].map(s => (
          <button
            key={s.key}
            onClick={() => setFilterStatus(s.key)}
            className={`text-[12px] px-2.5 py-1 rounded-lg transition-colors ${
              filterStatus === s.key
                ? 'bg-accent/60 text-foreground/80'
                : 'text-muted-foreground/60 hover:text-foreground/60 hover:bg-accent/25'
            }`}
          >
            {s.label}
            <span className="ml-1 text-muted-foreground/40">{statusCounts[s.key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <Input
        value={localSearchQuery}
        onChange={(e) => setLocalSearchQuery(e.target.value)}
        placeholder="搜尋書名或作者..."
        className="bg-accent/20 border-border/40 text-foreground/80 text-sm h-9 placeholder:text-muted-foreground/40"
      />

      {/* Book list */}
      {filteredBooks.length > 0 ? (
        <div className="grid gap-3">
          {filteredBooks.map((book) => (
            <div key={book.id} className="glass rounded-xl px-5 py-4 group hover:border-border/60 transition-all">
              <div className="flex items-start gap-4">
                {book.cover_url ? (
                  <div className="size-12 rounded-lg overflow-hidden shrink-0">
                    <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="size-12 rounded-lg bg-accent/30 flex items-center justify-center shrink-0">
                    <BookOpen className="size-5 text-muted-foreground/60" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px] font-medium text-foreground/80">{book.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusConfig[book.reading_status ?? ''] || ''}`}>
                      {statusLabels[book.reading_status ?? ''] || book.reading_status}
                    </span>
                  </div>
                  {book.authors && (
                    <div className="text-[12px] text-muted-foreground/50 mb-1.5">{book.authors}</div>
                  )}
                  {(book.rating ?? 0) > 0 && (
                    <div className="mb-1.5">{renderStars(book.rating ?? null)}</div>
                  )}
                  {book.personal_notes && (
                    <p className="text-[12px] text-muted-foreground/60 leading-relaxed line-clamp-2">{book.personal_notes}</p>
                  )}
                  {book.publisher && (
                    <div className="text-[11px] text-muted-foreground/40 mt-1.5">{book.publisher}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleEdit(book)}
                    className="size-7 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-foreground/60 hover:bg-accent/40 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteId(book.id)}
                    className="size-7 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-xl flex flex-col items-center justify-center py-16 text-muted-foreground/50">
          <BookOpen className="size-12 opacity-20" />
          <p className="mt-4 text-sm">{localSearchQuery || filterStatus !== 'all' ? '沒有找到符合條件的書籍' : '還沒有書籍'}</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除這本書嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作無法復原。書籍將被永久刪除。
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
