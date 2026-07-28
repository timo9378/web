import { useState, useRef, useEffect, createElement, type ElementType, type MouseEvent } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { LocaleLink } from '../locale-link';
import { useLocaleNavigate } from '../lib/useLocale';
import { stripLocalePrefix } from '../start-i18n';
import { useTranslation } from 'react-i18next';
import { FaUser,
  FaGithub, FaGoogle, FaSignOutAlt, FaCog,
} from 'react-icons/fa';
import { HouseIcon, BookOpenTextIcon, LayoutGridIcon } from '@animateicons/react/lucide';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/auth';
import { MegaMenuRoot, MegaMenu as MegaMenuItem } from './mega-menu/MegaMenu';
import HomeMenuContent from './mega-menu/HomeMenu';
import BlogMenuContent from './mega-menu/BlogMenu';
import MoreMenuContent from './mega-menu/MoreMenu';
import MobileNav from './MobileNav';
import meAvatar from '../assets/me-avatar.webp';
import './Header.css';

interface AnimIconHandle { startAnimation?: () => void; stopAnimation?: () => void }

/* 導覽列 trigger 的動畫 icon — 跟選單內同款（@animateicons imperative handle），
   hover prop 由 MegaMenu 的 trigger hover/open 狀態 cloneElement 注入 */
function TriggerAnimIcon({ Comp, hover }: { Comp: ElementType; hover?: boolean }) {
  const ref = useRef<AnimIconHandle>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (hover) ref.current.startAnimation?.();
    else ref.current.stopAnimation?.();
  }, [hover]);
  return createElement(Comp, { ref, size: 15, duration: 0.6 });
}

interface HeaderProps {
  activeSection?: string;
}

function Header(_props: HeaderProps) {
  const { t } = useTranslation();
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showHomeMenu, setShowHomeMenu] = useState(false); // 新增這行
  const [showBlogMenu, setShowBlogMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastScrollYRef = useRef(0);
  const homeMenuRef = useRef<HTMLDivElement>(null); // 新增這行
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const blogMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useRouterState({ select: (s) => s.location });
  const navigate = useLocaleNavigate();
  const { user, isLoggedIn, logout, providers, getGoogleAuthUrl, getGitHubAuthUrl, isAdmin } = useAuth();
  const bare = stripLocalePrefix(location.pathname); // 去 locale 前綴後的邏輯路徑(無前導斜線)
  const isHomePage = bare === '';

  useEffect(() => {
    const handleScroll = () => {
      const sy = window.scrollY;
      setIsScrolled(sy > 50);
      if (sy <= 100) {
        setNavHidden(false);
        lastScrollYRef.current = sy;
      } else if (sy > lastScrollYRef.current + 10) {
        setNavHidden(true);
        lastScrollYRef.current = sy;
      } else if (sy < lastScrollYRef.current - 10) {
        setNavHidden(false);
        lastScrollYRef.current = sy;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => { window.removeEventListener('scroll', handleScroll); };
  }, []);

  useEffect(() => {
    if (isHomePage && location.hash) {
      const t = setTimeout(() => {
        const el = document.getElementById(location.hash.replace('#', ''));
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [location.hash, isHomePage]);

  useEffect(() => {
    const handler = (e: MouseEvent | Event) => {
      const target = e.target as Node;
      if (homeMenuRef.current && !homeMenuRef.current.contains(target)) setShowHomeMenu(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) setShowMoreMenu(false);
      if (blogMenuRef.current && !blogMenuRef.current.contains(target)) setShowBlogMenu(false);
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setShowUserMenu(false);
    };
    if (showHomeMenu || showMoreMenu || showBlogMenu || showUserMenu) document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [showHomeMenu, showMoreMenu, showBlogMenu, showUserMenu]);

  const handleNavClick = (e: MouseEvent<Element>, sectionId: string) => {
    e.preventDefault();
    setMobileOpen(false);
    if (isHomePage) {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    } else {
      void navigate('/#' + sectionId);
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    const nav = e.currentTarget;
    const rect = nav.getBoundingClientRect();
    nav.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
    nav.style.setProperty('--my', ((e.clientY - rect.top) / rect.height * 100) + '%');
  };

  return (
    <header className={'site-header ' + (isScrolled && !mobileOpen ? 'scrolled ' : '') + (navHidden && !mobileOpen ? 'nav-hidden ' : '') + (mobileOpen ? 'menu-open ' : '')}>
      <LocaleLink to="/" className="site-brand" aria-label={t('nav.backHome')} onClick={() => setMobileOpen(false)}>
        <img src={meAvatar} alt="" className="site-brand-img" />
      </LocaleLink>
      {/* 手機導覽（Innei 式手風琴）— 桌面用下面的 mega-menu */}
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
      {/* onMouseMove 只用來讓高亮跟著游標，純視覺裝飾；
          導覽列本身的連結都在焦點序列內，鍵盤不缺任何功能 */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <nav className="site-nav" onMouseMove={handleMouseMove}>
        <MegaMenuRoot className="nav-list nav-list-mega">
          <MegaMenuItem
            id="home"
            label={t('nav.home')}
            icon={<TriggerAnimIcon Comp={HouseIcon} />}
            to="/"
            active={(isHomePage && !location.hash)
                 || bare.startsWith('about-site')
                 || bare.startsWith('history')
                 || bare.startsWith('messages')
                 || bare.startsWith('friends')
                 || bare.startsWith('thinking')
                 || bare.startsWith('about')
                 || bare.startsWith('portfolio')}
          >
            <HomeMenuContent
              onSectionClick={(e, sectionId) => { handleNavClick(e, sectionId); }}
            />
          </MegaMenuItem>

          <MegaMenuItem
            id="blog"
            label={t('nav.notes')}
            icon={<TriggerAnimIcon Comp={BookOpenTextIcon} />}
            to="/blog"
            active={bare.startsWith('blog')
                 || bare.startsWith('bookshelf')
                 || bare.startsWith('music')}
          >
            <BlogMenuContent />
          </MegaMenuItem>

          <MegaMenuItem
            id="more"
            label={t('nav.more')}
            icon={<TriggerAnimIcon Comp={LayoutGridIcon} />}
            active={bare.startsWith('photos')
                 || bare.startsWith('activity')
                 || bare.startsWith('setup')
                 || bare.startsWith('watch')}
          >
            <MoreMenuContent />
          </MegaMenuItem>
        </MegaMenuRoot>
      </nav>

      {/* 暫時隱藏履歷按鈕
      <button className="resume-btn" onClick={() => setShowDownloadModal(!showDownloadModal)}>
        <FaDownload className="resume-icon" />
        <span>履歷</span>
      </button>
      */}

      <div className="header-right-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* User Avatar / Login */}
        <div className="user-area" ref={userMenuRef}>
          <button className="user-avatar-btn" onClick={() => setShowUserMenu(!showUserMenu)} aria-label={t('user.menuLabel')} aria-expanded={showUserMenu}>
            {isLoggedIn && user?.avatar ? (
              <img src={user.avatar} alt={user.displayName} className="user-avatar-img" referrerPolicy="no-referrer" />
            ) : (
              <FaUser className="user-avatar-icon" />
            )}
          </button>
          <AnimatePresence>
            {showUserMenu && (
              <motion.div className="user-dropdown" initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ duration: 0.2 }}>
                {isLoggedIn ? (
                  <>
                    <div className="user-dropdown-header">
                      <span className="user-dropdown-name">{user?.displayName}</span>
                      <span className="user-dropdown-provider">@{user?.displayName}</span>
                    </div>
                    <div className="user-dropdown-divider" />
                    {isAdmin && (
                      <button className="user-dropdown-item" onClick={() => { window.location.assign('/admin'); setShowUserMenu(false); }}>
                        <FaCog /> {t('user.adminPanel')}
                      </button>
                    )}
                    <button className="user-dropdown-item" onClick={() => { logout(); setShowUserMenu(false); }}>
                      <FaSignOutAlt /> {t('user.logout')}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="user-dropdown-header">
                      <span className="user-dropdown-name">{t('user.signInLabel')}</span>
                    </div>
                    <div className="user-dropdown-divider" />
                    {providers.github?.enabled && (
                      <button className="user-dropdown-item" onClick={() => {
                        sessionStorage.setItem('oauth_return_to', location.pathname);
                        const redirectUri = `${window.location.origin}/auth/callback`;
                        window.location.href = getGitHubAuthUrl(redirectUri) + '&state=github';
                      }}>
                        <FaGithub /> {t('user.signInWithGithub')}
                      </button>
                    )}
                    {providers.google?.enabled && (
                      <button className="user-dropdown-item" onClick={() => {
                        sessionStorage.setItem('oauth_return_to', location.pathname);
                        const redirectUri = `${window.location.origin}/auth/callback`;
                        window.location.href = getGoogleAuthUrl(redirectUri) + '&state=google';
                      }}>
                        <FaGoogle /> {t('user.signInWithGoogle')}
                      </button>
                    )}
                    {!providers.github?.enabled && !providers.google?.enabled && (
                      <div className="user-dropdown-item disabled">{t('user.notConfigured')}</div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button className={'mobile-toggle ' + (mobileOpen ? 'open' : '')} onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle navigation">
          <span /><span /><span />
        </button>
      </div>

      <AnimatePresence>
        {showDownloadModal && (
          <>
            <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDownloadModal(false)} />
            <motion.div className="download-popover" initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }} transition={{ duration: 0.2 }}>
              <h3>{t('nav.downloadResume')}</h3>
              <a href="/Resume/Software Engineer.pdf" download="Koimsurai_Resume_Software_Engineer.pdf" className="popover-link">
                <span>💼</span> {t('nav.resumeSE')}
              </a>
              <a href="/Resume/School Clubs.pdf" download="Koimsurai_Resume_School_Clubs.pdf" className="popover-link">
                <span>🎓</span> {t('nav.resumeClubs')}
              </a>
              <button className="popover-close" onClick={() => setShowDownloadModal(false)}>{t('common.close')}</button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header >
  );
}

export default Header;
