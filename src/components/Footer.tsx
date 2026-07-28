import { useQuery } from '@tanstack/react-query';
import { LocaleLink } from '../locale-link';
import { useTranslation } from 'react-i18next';
import { siteStatsQueryOptions } from '../homeData';
import LanguagePicker from './LanguagePicker';
import './Footer.css';

const START_YEAR = 2025;

interface Stats {
  total: number;
  days: number;
}

// 站台統計改由 TanStack Query 讀（與 mega-menu 共用 siteStatsQueryOptions 快取）。
// 失敗 / 未載入時 data 為 undefined → 回 null，走 fallback 顯示（對齊舊 catch 靜默）。
function useStats(): Stats | null {
  const { data } = useQuery(siteStatsQueryOptions);
  if (data?.message !== 'success') return null;
  return { total: data.total_posts, days: data.days };
}

// 在線人數：目前後端沒有 endpoint，直接回傳 null 走 fallback 顯示文章數 / 天數
// 之後想做即時人數，可加 SSE / WebSocket，或前端 fetch /api/online
function useOnline(): number | null {
  return null;
}

const ExternalArrow = () => (
  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden style={{ marginLeft: 3, opacity: 0.6 }}>
    <path d="M3 1h6v6M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// 模組載入時算一次，不在 render 期呼叫 new Date()：render 必須是純的
//（react-hooks/purity）。年份一年才變一次，模組層級足夠。
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_RANGE = CURRENT_YEAR > START_YEAR ? `${START_YEAR}-${CURRENT_YEAR}` : String(START_YEAR);

function Footer() {
  const { t } = useTranslation();
  const stats = useStats();
  const online = useOnline();

  return (
    <footer className="app-footer">
      <div className="app-footer-glow" aria-hidden />
      <div className="app-footer-container">
        <div className="app-footer-grid">
          {/* 品牌欄 */}
          <div className="app-footer-brand">
            <h3 className="app-footer-brand-name brand-wordmark">Koimsurai</h3>
            <p className="app-footer-brand-tagline">{t('footer.tagline')}</p>
            <p className="app-footer-copy">
              © {YEAR_RANGE} {t('footer.poweredBy')}{' '}
              <a href="https://github.com/timo9378/web" target="_blank" rel="noopener noreferrer">
                Koim Stack
              </a>
              {' & '}
              <a href="https://vitejs.dev" target="_blank" rel="noopener noreferrer">Vite</a>
            </p>
            <div className="app-footer-meta">
              <span className="app-footer-viewers">
                <span className="app-footer-dot" />
                {typeof online === 'number'
                  ? t('footer.viewersOnline', { count: online })
                  : stats
                    ? t('footer.statsLine', { posts: stats.total, days: stats.days })
                    : t('footer.loading')}
              </span>
            </div>
          </div>

          {/* 關於 */}
          <div className="app-footer-col">
            <h4 className="app-footer-col-title">{t('footer.sections.about')}</h4>
            <LocaleLink to="/about-site" className="app-footer-link">{t('footer.links.aboutSite')}</LocaleLink>
            <LocaleLink to="/about" className="app-footer-link">{t('footer.links.aboutMe')}</LocaleLink>
            <a
              href="https://github.com/timo9378/web"
              target="_blank"
              rel="noopener noreferrer"
              className="app-footer-link"
            >
              {t('footer.links.aboutProject')} <ExternalArrow />
            </a>
          </div>

          {/* 更多 — 配備改放服務狀態（Kuma），配備仍可從導覽列「更多」進 */}
          <div className="app-footer-col">
            <h4 className="app-footer-col-title">{t('footer.sections.more')}</h4>
            <LocaleLink to="/photos" className="app-footer-link">{t('footer.links.photos')}</LocaleLink>
            <LocaleLink to="/activity" className="app-footer-link">{t('footer.links.activity')}</LocaleLink>
            <a
              href="https://status.koimsurai.com"
              target="_blank"
              rel="noopener noreferrer"
              className="app-footer-link"
            >
              {t('footer.links.status')} <ExternalArrow />
            </a>
          </div>

          {/* 聯絡 */}
          <div className="app-footer-col">
            <h4 className="app-footer-col-title">{t('footer.sections.contact')}</h4>
            {/* 寫留言改連留言板頁（原本 /#contact 在 lazy section 掛載前 hash 捲動會失敗） */}
            <LocaleLink to="/messages" className="app-footer-link">{t('footer.links.messages')}</LocaleLink>
            <a href="mailto:timo9378@gmail.com" className="app-footer-link">
              {t('footer.links.email')} <ExternalArrow />
            </a>
            <a
              href="https://github.com/timo9378"
              target="_blank"
              rel="noopener noreferrer"
              className="app-footer-link"
            >
              {t('footer.links.github')} <ExternalArrow />
            </a>
          </div>
        </div>

        {/* 底部分隔 + 線 */}
        <div className="app-footer-divider" aria-hidden />

        {/* 底部資訊列 */}
        <div className="app-footer-bottom">
          <div className="app-footer-bottom-left">
            <a href="/api/rss" target="_blank" rel="noopener noreferrer" className="app-footer-bottom-link">
              {t('footer.links.rss')}
            </a>
            <span className="app-footer-bottom-sep">·</span>
            <a href="/sitemap.xml" target="_blank" rel="noopener noreferrer" className="app-footer-bottom-link">
              {t('footer.links.sitemap')}
            </a>
            <span className="app-footer-bottom-sep">·</span>
            <a href="/#contact" className="app-footer-bottom-link">{t('footer.links.subscribe')}</a>
          </div>

          <div className="app-footer-bottom-right">
            <LanguagePicker />
            <span className="app-footer-bottom-sep">·</span>
            <span className="app-footer-bottom-meta brand-wordmark">Koimsurai © {CURRENT_YEAR}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
