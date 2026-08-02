import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate, type LinkProps } from '@tanstack/react-router';
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Tags,
  BookOpen,
  Library,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  LogOut,
  User,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  SaveAll,
  Send,
  MessageSquare,
  Mail,
  Home,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '../../contexts/auth';
import './AdminTheme.css';
import './ModernEnhancements.css';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const BREADCRUMB_LABELS: Record<string, string> = {
  admin: '後台',
  dashboard: '儀表板',
  posts: '文章',
  categories: '分類',
  tags: '標籤',
  comments: '留言',
  notes: '日記',
  books: '書籍',
  editor: '編輯器',
  create: '新增',
  edit: '編輯',
  'article-generator': 'AI 寫作',
};

/**
 * 麵包屑的中繼連結。
 *
 * TanStack 的 `Link` 把 `to` 對著 route tree 做型別檢查，而麵包屑是從當前 pathname
 * 逐段拼出來的字串，型別上對不起來。這裡刻意退回原生 `<a>` 而不是硬轉型：
 *
 *   - 硬轉型（`to={href as never}`）會騙過編譯器，但拼錯路徑仍然只有執行期才知道，
 *     等於付了型別的醜、卻沒買到型別的保障。
 *   - 麵包屑的中繼層級只有 `/admin`、`/admin/posts` 這種，點下去整頁重載一次的成本
 *     對後台可以接受（而且後台本來就是 client-only、沒有 SSR 要保）。
 *
 * 側欄那組連結是**寫死的已知路徑**，所以那邊照樣用 `Link`，享有型別檢查。
 */
const BreadcrumbAnchor = ({ href, label }: { href: string; label: string }) => (
  <BreadcrumbLink asChild>
    <a href={href}>{label}</a>
  </BreadcrumbLink>
);

const AdminBreadcrumb = () => {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const href = '/' + segments.slice(0, index + 1).join('/');
          const isLast = index === segments.length - 1;
          const label = BREADCRUMB_LABELS[segment] || segment;

          return (
            <React.Fragment key={href}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbAnchor href={href} label={label} />
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator><ChevronRight /></BreadcrumbSeparator>}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

// path 用 Link 的 `to` 型別而不是 string：側欄路徑寫錯（或某天路由改名）會在編譯期就被抓到。
// 這是換到 TanStack 之後真正多拿到的東西——react-router 時代這裡是純字串，打錯要等點下去才知道。
type AdminPath = NonNullable<LinkProps['to']>;
interface SidebarItem { id: string; icon: LucideIcon; label: string; path: AdminPath; ownerOnly?: boolean }

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: '儀表板', path: '/admin/dashboard' },
  { id: 'posts', icon: FileText, label: '文章', path: '/admin/posts' },
  { id: 'categories', icon: FolderOpen, label: '分類', path: '/admin/categories' },
  { id: 'tags', icon: Tags, label: '標籤', path: '/admin/tags' },
  { id: 'comments', icon: MessageSquare, label: '留言', path: '/admin/comments' },
  { id: 'subscribers', icon: Mail, label: '電子報訂閱', path: '/admin/subscribers' },
  { id: 'notes', icon: BookOpen, label: '日記', path: '/admin/notes' },
  { id: 'books', icon: Library, label: '書籍', path: '/admin/books' },
  { id: 'article-generator', icon: Sparkles, label: 'AI 寫作', path: '/admin/article-generator' },
  { id: 'users', icon: Users, label: '用戶管理', path: '/admin/users', ownerOnly: true },
];

export const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout, isOwner } = useAuth();

  // TanStack 的 navigate 收物件（`{ to }`）而不是字串，這是與 react-router 最主要的簽名差異。
  const handleLogout = () => {
    logout();
    void navigate({ to: '/' });
  };

  useEffect(() => {
    document.body.classList.add('admin-mode');
    return () => {
      document.body.classList.remove('admin-mode');
    };
  }, []);

  // 過濾 sidebar：ownerOnly 僅 OWNER 可見
  const visibleSidebarItems = sidebarItems.filter(item => !item.ownerOnly || isOwner);

  return (
    <div className="min-h-screen admin-layout deep-space-bg">
      {/*
        後台的 toast 出口。`components/ui/sonner.tsx` 連配色都寫好了，但在這行之前
        **沒有任何地方掛載它**——於是 11 個後台元件裡所有的 `toast.success/error`
        全部靜靜地不見，站長按下儲存、發佈、刪除都沒有任何回饋。

        比「少了提示」更嚴重的是 PostEditor 的**草稿還原**：自動備份確實寫進
        localStorage，但唯一的還原入口是 toast 裡的「還原」按鈕，那顆按鈕從來
        沒有出現過——備份寫了卻永遠取不回來。整個功能等於是死的。
        （是寫 e2e 時發現的：存草稿明明回 201 也轉頁了，畫面上卻找不到任何 toast。）

        ⚠️ 位置要放在 `<Outlet />` **之前**。sonner 的 `toast()` 是推給已經訂閱的
        Toaster，而 React 的 effect 依樹的順序跑——放在 Outlet 後面的話，
        頁面元件「在掛載當下就發出」的那些 toast（PostEditor 的草稿還原提示就是）
        會在 Toaster 訂閱之前送出，直接消失。使用者按鈕觸發的看起來正常，
        只有這種開場提示會不見，很難察覺。

        掛在這裡而不是 __root：目前 `toast` 的使用者全部在 components/admin/ 底下。
      */}
      <Toaster />

      {/* Stars overlay */}
      <div className="stars" />

      {/* Sidebar - Desktop */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen transition-all duration-300 border-r border-border/40",
          sidebarOpen ? "w-52" : "w-[60px]",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex items-center h-14 px-3 shrink-0">
            {sidebarOpen ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="size-7 rounded-md bg-foreground/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-foreground/80">K</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-medium text-foreground/90 truncate leading-tight">Koimsurai</span>
                    <span className="text-[11px] text-muted-foreground truncate leading-tight">管理後台</span>
                  </div>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground/80 hover:bg-accent/50 transition-colors">
                  <PanelLeftClose className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex w-full justify-center">
                <button onClick={() => setSidebarOpen(true)} className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground/80 hover:bg-accent/50 transition-colors">
                  <PanelLeftOpen className="size-4" />
                </button>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
            {visibleSidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.path);

              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[7px] text-[13px] transition-colors",
                    isActive
                      ? "bg-accent/80 text-foreground"
                      : "text-muted-foreground hover:text-foreground/80 hover:bg-accent/40",
                    !sidebarOpen && "justify-center px-0"
                  )}
                >
                  <Icon className="size-[16px] shrink-0" />
                  {sidebarOpen && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* User Menu */}
          <div className="px-3 py-3 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded-lg transition-colors hover:bg-accent/30 p-1",
                    !sidebarOpen && "justify-center p-0"
                  )}
                >
                  <Avatar className="size-7 shrink-0">
                    {user?.avatar && <AvatarImage src={user.avatar} alt={user.displayName ?? '管理員'} />}
                    <AvatarFallback className="bg-zinc-800 text-zinc-300 text-[11px] font-medium border border-zinc-700/60">
                      {(user?.displayName ?? '管理員').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {sidebarOpen && (
                    <div className="flex flex-col min-w-0 text-left">
                      <span className="text-[13px] font-medium text-foreground/80 truncate leading-tight">{user?.displayName ?? '管理員'}</span>
                      <span className="text-[11px] text-muted-foreground truncate leading-tight">{user?.email ?? ''}</span>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>我的帳戶</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { void navigate({ to: '/' }); }}>
                  <Home className="mr-2 h-4 w-4" />
                  回到前台
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  個人資料
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  登出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div
        className={cn(
          "transition-all duration-300 relative z-10",
          sidebarOpen ? "md:ml-52" : "md:ml-[60px]"
        )}
      >
        {/* Header */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border/40 glass-subtle px-4 sm:px-6"
        >
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X /> : <Menu />}
          </Button>

          <AdminBreadcrumb />

          {pathname.includes('/admin/posts/edit') || pathname.includes('/admin/posts/create') || pathname === '/admin/posts/new' ? (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground/80 px-2.5" onClick={() => document.getElementById('save-draft-btn')?.click()}>
                <Save className="size-3.5" />
                儲存草稿
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground/80 px-2.5" onClick={() => document.getElementById('save-exit-btn')?.click()}>
                <SaveAll className="size-3.5" />
                存並回列表
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-foreground/80 border-border/50 hover:bg-accent/50 px-3" onClick={() => document.getElementById('publish-btn')?.click()}>
                <Send className="size-3.5" />
                發佈文章
              </Button>
            </div>
          ) : null}
        </header>

        {/* Content */}
        <main className="min-h-screen">
          <Outlet />
        </main>
      </div>

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        // 手機側欄的遮罩，點它收起選單；鍵盤路徑是選單本身的開關鈕
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default AdminLayout;
