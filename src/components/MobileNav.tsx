// 手機導覽 — Innei 式全寬手風琴（取代 mega-menu 在手機被硬塞的 hover 面板）。
// 頂部品牌 + 關閉；可展開的列點 chevron 內聯展開子項；底部「更多」快捷 + 訂閱。
import { useState } from 'react';
import { LocaleLink } from '../locale-link';
import { useTranslation } from 'react-i18next';
import { FaChevronDown, FaTimes } from 'react-icons/fa';
import './MobileNav.css';

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

interface NavChild {
  to: string;
  label: string;
}

interface NavGroup {
  key: string;
  label: string;
  to?: string;
  children?: NavChild[];
}

export default function MobileNav({ open, onClose }: MobileNavProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (key: string) => { setExpanded((cur) => (cur === key ? null : key)); };

  // 主結構：可展開的列帶 children；純連結的列直接走 Link
  const groups: NavGroup[] = [
    { key: 'home', label: t('nav.home'), to: '/', children: [
      { to: '/about', label: t('megaMenu.items.about') },
      { to: '/about#journey', label: t('megaMenu.items.journey') },
      { to: '/portfolio', label: t('megaMenu.items.portfolio') },
    ] },
    { key: 'notes', label: t('nav.notes'), to: '/blog', children: [
      { to: '/bookshelf', label: t('megaMenu.items.bookshelf') },
      { to: '/music', label: t('megaMenu.items.music') },
    ] },
    { key: 'watch', label: t('megaMenu.items.watch'), to: '/watch' },
    { key: 'thinking', label: t('megaMenu.items.thinking'), to: '/thinking' },
    { key: 'more', label: t('nav.more'), children: [
      { to: '/photos', label: t('megaMenu.items.photos') },
      { to: '/activity', label: t('megaMenu.items.activity') },
      { to: '/setup', label: t('megaMenu.items.setup') },
      { to: '/about-site', label: t('megaMenu.items.aboutSite') },
      { to: '/history', label: t('megaMenu.items.history') },
      { to: '/messages', label: t('megaMenu.items.messages') },
      { to: '/friends', label: t('megaMenu.items.friends') },
    ] },
  ];

  return (
    <div
      className={`mnav ${open ? 'mnav--open' : ''}`}
      // <dialog> 有自己的 top-layer 與 showModal/close 生命週期，換過去等於重寫開關邏輯
      // 與焦點管理；目前 role="dialog" + aria-modal + inert 已達成同樣的可存取行為
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.menu')}
      inert={!open}
    >
      <div className="mnav-head">
        <span className="mnav-brand">宙と木</span>
        <button className="mnav-close" onClick={onClose} aria-label={t('common.close')}><FaTimes /></button>
      </div>

      <nav className="mnav-list">
        {groups.map((g) => {
          const isOpen = expanded === g.key;
          return (
            <div className={`mnav-group ${isOpen ? 'is-open' : ''}`} key={g.key}>
              <div className="mnav-row">
                {g.to ? (
                  <LocaleLink to={g.to} className="mnav-row-label" onClick={onClose}>{g.label}</LocaleLink>
                ) : (
                  <button className="mnav-row-label" onClick={() => toggle(g.key)}>{g.label}</button>
                )}
                {g.children && (
                  <button
                    className="mnav-row-toggle"
                    onClick={() => toggle(g.key)}
                    aria-label={g.label}
                    aria-expanded={isOpen}
                  >
                    <FaChevronDown className={`mnav-chev ${isOpen ? 'is-open' : ''}`} />
                  </button>
                )}
              </div>
              {g.children && (
                <div className="mnav-sub-wrap">
                  <div className="mnav-sub">
                    {g.children.map((c) => (
                      <LocaleLink key={c.to} to={c.to} className="mnav-sub-link" onClick={onClose}>{c.label}</LocaleLink>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mnav-foot">
        <LocaleLink to="/#contact" className="mnav-subscribe" onClick={onClose}>{t('footer.links.subscribe')}</LocaleLink>
      </div>
    </div>
  );
}
