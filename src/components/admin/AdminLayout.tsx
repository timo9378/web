import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
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

const AdminBreadcrumb = () => {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

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
                  <BreadcrumbLink asChild>
                    <Link to={href}>{label}</Link>
                  </BreadcrumbLink>
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

interface SidebarItem { id: string; icon: LucideIcon; label: string; path: string; ownerOnly?: boolean }

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
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isOwner } = useAuth();

  const handleLogout = () => {
    logout();
    void navigate('/');
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
              const isActive = location.pathname.startsWith(item.path);

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
                <DropdownMenuItem onClick={() => { void navigate('/'); }}>
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

          {location.pathname.includes('/admin/posts/edit') || location.pathname.includes('/admin/posts/create') || location.pathname === '/admin/posts/new' ? (
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
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default AdminLayout;
