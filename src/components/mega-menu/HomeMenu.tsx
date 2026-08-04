import { useState, useEffect, useMemo, useRef, createElement, type ReactNode, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { MegaMenuPanel, MegaMenuColumn } from './MegaMenu';
import avatarImage from '../../assets/me-avatar.webp';
import { UserIcon } from '@/components/animate-ui/icons/user';
import { LayersIcon } from '@/components/animate-ui/icons/layers';
import { SendIcon } from '@/components/animate-ui/icons/send';
import { RouteIcon } from '@/components/animate-ui/icons/route';
import { HouseIcon, MailIcon, GithubIcon, LinkedinIcon, InfoIcon, CompassIcon, MessageCircleIcon, UsersIcon, SparklesIcon as SparklesAnimIcon, FacebookIcon, InstagramIcon, WifiIcon } from '@animateicons/react/lucide';
import { LocaleLink } from '@/i18n/locale-link';
import { useQuery } from '@tanstack/react-query';
import { siteStatsQueryOptions } from '@/data/homeData';

interface AnimateIconHandle { startAnimation?: () => void; stopAnimation?: () => void }

/**
 * @animateicons/react 走 imperative handle（startAnimation / stopAnimation），
 * 不會 watch isAnimated prop 變化來自動播動畫，所以需要 ref。
 */
function AnimateIconsLibIcon({ Comp, size = 16, duration = 0.6, hover }: { Comp: ElementType; size?: number; duration?: number; hover?: boolean }) {
  const ref = useRef<AnimateIconHandle>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (hover) ref.current.startAnimation?.();
    else ref.current.stopAnimation?.();
  }, [hover]);
  return createElement(Comp, { ref, size, duration });
}

interface AnimatedSectionLinkProps {
  id?: string;
  to?: string;
  AnimIcon?: ElementType;
  AnimateIconsLib?: ElementType;
  FallbackIcon?: ElementType;
  title: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Section anchor：用 hover state 驅動 icon animate prop。
 * 同時支援 animate-ui（animate prop）跟 @animateicons/react（ref imperative）兩家。
 */
function AnimatedSectionLink({ id, to, AnimIcon, AnimateIconsLib, FallbackIcon, title, onClick }: AnimatedSectionLinkProps) {
  const [hover, setHover] = useState(false);
  const inner = (
    <>
      <span className={`mega-menu-link-icon${(AnimIcon || AnimateIconsLib) ? ' mega-menu-link-icon--motion' : ''}`}>
        {AnimIcon
          ? createElement(AnimIcon, { size: 16, animate: hover ? 'default' : false })
          : AnimateIconsLib
            ? <AnimateIconsLibIcon Comp={AnimateIconsLib} hover={hover} />
            : FallbackIcon && createElement(FallbackIcon)
        }
      </span>
      <span className="mega-menu-link-title">{title}</span>
    </>
  );
  const common = {
    className: 'mega-menu-link mega-menu-link--compact',
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };
  // to = 頁面連結（/about、/portfolio…）；id = 首頁區段錨點
  if (to) return <LocaleLink to={to} {...common} onClick={onClick}>{inner}</LocaleLink>;
  return <a href={`#${id ?? ''}`} {...common} onClick={onClick}>{inner}</a>;
}

function AnimatedSocial({ href, AnimIcon, label, external = true, className = '' }: { href: string; AnimIcon: ElementType; label: string; external?: boolean; className?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      className={`mega-menu-social mega-menu-social--motion ${className}`}
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <AnimateIconsLibIcon Comp={AnimIcon} size={14} duration={0.5} hover={hover} />
    </a>
  );
}

interface Stats { total: number; wordCount: number; days: number }

interface SectionLink {
  id?: string;
  to?: string;
  AnimIcon?: ElementType;
  AnimateIconsLib?: ElementType;
  title: ReactNode;
}

/**
 * 首頁 menu 內容：
 *   左欄：作者頭像 / 線上狀態 / 統計（文章 N 篇 / 字數 / 寫了多少天）/ 社群圖示
 *   右欄：首頁區段（首頁 / 關於 / 技能 / 作品 / 聯絡）
 */
function HomeMenuContent({ onSectionClick }: { onSectionClick?: (e: React.MouseEvent, id: string) => void }) {
  const { t } = useTranslation();
  // 站台統計改吃共用 siteStatsQueryOptions 快取（Footer 也用同一把）。
  const { data: statsData } = useQuery(siteStatsQueryOptions);
  // 要 useMemo：否則每次 render 都是一個新物件，下面 wordCountLabel 的 useMemo
  // 依賴它就永遠命中不了，等於白寫。
  const stats: Stats | null = useMemo(
    () => (statsData?.message === 'success'
      ? { total: statsData.total_posts, wordCount: statsData.total_chars, days: statsData.days }
      : null),
    [statsData],
  );

  const wordCountLabel = useMemo(() => {
    if (!stats?.wordCount) return '—';
    if (stats.wordCount >= 10000) {
      return `${(stats.wordCount / 10000).toFixed(1)} 萬`;
    }
    if (stats.wordCount >= 1000) {
      return `${(stats.wordCount / 1000).toFixed(1)} 千`;
    }
    return String(stats.wordCount);
  }, [stats]);

  // 首頁瘦身後：關於我/成長軌跡/作品 是獨立頁面連結；首頁/聯絡 仍是首頁錨點
  const sections: SectionLink[] = [
    { id: 'home',           AnimateIconsLib: HouseIcon, title: t('megaMenu.items.home') },
    { to: '/about',         AnimIcon: UserIcon,         title: t('megaMenu.items.about') },
    { to: '/about#journey', AnimIcon: RouteIcon,        title: t('megaMenu.items.journey') },
    { to: '/portfolio',     AnimIcon: LayersIcon,       title: t('megaMenu.items.portfolio') },
    { id: 'contact',        AnimIcon: SendIcon,         title: t('megaMenu.items.contact') },
  ];

  // 說明文字拔掉（跟頁面欄完全同款 compact），兩欄整齊對齊
  const siteLinks: SectionLink[] = [
    { to: '/about-site', AnimateIconsLib: InfoIcon,          title: t('megaMenu.items.aboutSite') },
    { to: '/thinking',   AnimateIconsLib: SparklesAnimIcon,  title: t('megaMenu.items.thinking') },
    { to: '/history',    AnimateIconsLib: CompassIcon,       title: t('megaMenu.items.history') },
    { to: '/messages',   AnimateIconsLib: MessageCircleIcon, title: t('megaMenu.items.messages') },
    { to: '/friends',    AnimateIconsLib: UsersIcon,         title: t('megaMenu.items.friends') },
  ];

  return (
    <MegaMenuPanel className="mega-menu-panel--compact">
      <MegaMenuColumn>
        <div className="mega-menu-profile mega-menu-profile--compact">
          <div className="mega-menu-profile-row">
            <div className="mega-menu-profile-avatar">
              <img src={avatarImage} alt="Koimsurai" loading="lazy" />
            </div>
            <div className="mega-menu-profile-text">
              <div className="mega-menu-profile-name">Koimsurai</div>
              <div className="mega-menu-profile-status">{t('megaMenu.online')}</div>
            </div>
          </div>
          {/* 統計收斂成安靜的單行 meta（原本三組大數字太搶，跟右欄落差大） */}
          <p className="mega-menu-stats-line">
            {stats?.total ?? '—'} {t('megaMenu.stats.posts')}
            <span className="mega-menu-stats-dot">·</span>
            {wordCountLabel} {t('megaMenu.stats.words')}
            <span className="mega-menu-stats-dot">·</span>
            {stats?.days ?? '—'} {t('megaMenu.stats.days')}
          </p>
          <div className="mega-menu-socials">
            <AnimatedSocial href="https://github.com/timo9378" AnimIcon={GithubIcon} label="GitHub" />
            <AnimatedSocial href="https://www.linkedin.com/in/timo9378" AnimIcon={LinkedinIcon} label="LinkedIn" />
            <AnimatedSocial href="mailto:timo9378@gmail.com" AnimIcon={MailIcon} label="Email" external={false} />
            <AnimatedSocial href="https://www.facebook.com/profile.php?id=100003126780663" AnimIcon={FacebookIcon} label="Facebook" />
            <AnimatedSocial href="https://www.instagram.com/koimsurai.23/?hl=zh-tw" AnimIcon={InstagramIcon} label="Instagram" />
            {/* RSS 沒有現成動畫 icon：Wifi 轉 45° 就是 RSS 的形（CSS 處理旋轉） */}
            <AnimatedSocial href="/api/rss" AnimIcon={WifiIcon} label="RSS" className="mega-menu-social--rss" />
          </div>
        </div>
      </MegaMenuColumn>

      <MegaMenuColumn title={t('megaMenu.groups.pages')}>
        {sections.map((s) => {
          const sid = s.id;
          return (
            <AnimatedSectionLink
              key={sid ?? s.to}
              {...s}
              // 只有錨點項走 section handler；頁面 Link 交給 react-router
              onClick={sid ? (e) => onSectionClick?.(e, sid) : undefined}
            />
          );
        })}
      </MegaMenuColumn>

      <MegaMenuColumn title={t('megaMenu.groups.site')}>
        {siteLinks.map((s) => (
          <AnimatedSectionLink key={s.to} {...s} />
        ))}
      </MegaMenuColumn>
    </MegaMenuPanel>
  );
}

export default HomeMenuContent;
