import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LocaleLink } from '@/i18n/locale-link';
import { openCommandPalette } from '@/store/commandPaletteStore';
import './NotFound.css';

/**
 * 404 頁。
 *
 * ## 構圖
 *
 * 左邊是一條漸層的縱向軸線，內容掛在它上面；右邊是一段軌道弧線，帶一個脫離軌道的
 * 光點——「迷失在星際之間」的字面意思，也是這一頁唯一的圖像。它刻意畫得很淡並且
 * 溢出畫面右緣：要的是深度，不是搶戲。
 *
 * 前一版的問題是**沒有構圖**：一個 44rem 寬的盒子裡放四個字的路徑、三顆一模一樣的
 * 圓角矩形按鈕，全部垂直堆疊。這一版把那兩件事都拆了——路徑改成貼著內容的行內標記，
 * 次要動作改成帶箭頭的文字連結，只留一顆實心按鈕。
 *
 * ## 其他決定
 *
 * · 主角是那句話，不是那個數字。404 只是狀態碼。
 * · 給搜尋，不只給連結。舊連結與打錯字的人都知道自己要找什麼，丟回首頁等於
 *   要他從頭再找一次。手機沒有 ⌘K，所以那顆按鈕是它們唯一的入口
 *   （見 store/commandPaletteStore.ts）。
 */
const NotFound = () => {
  const { t } = useTranslation();
  // 只取 pathname：query 可能帶 token 之類的東西，印在畫面上沒有必要
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="nf-page">
      {/* 前景濾鏡：壓暗亮星空，跟 .about-scrim / .w-scrim / .wl-scrim 同款。
          少了它，文字會直接壓在最亮的那片星空上，對比整個垮掉。 */}
      <div className="nf-scrim" />

      <div className="nf-inner">
        <div className="nf-body">
          <p className="nf-eyebrow">
            <span className="nf-dot" aria-hidden="true" />
            404 · {t('notFound.pageTitleShort')}
          </p>

          {/* ⚠ 必須是 <h1>。少了一級標題 axe 的 page-has-heading-one 會紅，
              而這一頁在 /ja/blog/1 之類沒有該語系版本的路徑上也會渲染，
              所以那條 a11y 測試真的走得到這裡。 */}
          <h1 className="nf-title">{t('notFound.lostMessage')}</h1>
          <p className="nf-sub">{t('notFound.subMessage')}</p>

          {/* 路徑：貼著內容的行內標記，不是一個撐滿寬度的空盒子。
              長路徑會換行（見 CSS 的 overflow-wrap）。 */}
          <p className="nf-addr">
            <span className="nf-addr-label">{t('notFound.requested')}</span>
            <code className="nf-addr-path">{pathname}</code>
          </p>

          <div className="nf-actions">
            <button type="button" className="nf-btn nf-btn--primary" onClick={openCommandPalette}>
              {t('notFound.search')}
              <kbd className="nf-kbd">⌘K</kbd>
            </button>
            {/* 次要動作用文字連結而不是第二、第三顆按鈕——三顆一樣的矩形沒有主次 */}
            <LocaleLink to="/" className="nf-link">
              {t('notFound.backHome')}
              <span className="nf-arrow" aria-hidden="true">→</span>
            </LocaleLink>
            <LocaleLink to="/blog" className="nf-link">
              {t('nav.notes')}
              <span className="nf-arrow" aria-hidden="true">→</span>
            </LocaleLink>
          </div>
        </div>

        {/* 軌道：純裝飾，訊息全在左邊的文字裡 */}
        <svg className="nf-orbit" viewBox="0 0 320 320" fill="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="nf-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7f5af0" stopOpacity="0.85" />
              <stop offset="1" stopColor="#2cb67d" stopOpacity="0.25" />
            </linearGradient>
            <radialGradient id="nf-spark">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#7f5af0" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* 三圈同心軌道，越外圈越淡 */}
          <circle cx="160" cy="160" r="150" stroke="url(#nf-arc)" strokeWidth="1" opacity=".28" />
          <circle cx="160" cy="160" r="112" stroke="url(#nf-arc)" strokeWidth="1" opacity=".45" />
          <circle cx="160" cy="160" r="70" stroke="url(#nf-arc)" strokeWidth="1.2" opacity=".6" />
          {/* 還在軌道上的兩顆 */}
          <circle cx="160" cy="48" r="4" fill="#7f5af0" opacity=".85" />
          <circle cx="248" cy="216" r="3" fill="#2cb67d" opacity=".7" />
          {/* 脫離軌道的那一顆：虛線是它偏離的路徑 */}
          <path className="nf-stray-path" d="M230 90 q34 -30 74 -18" stroke="rgba(255,255,255,.35)"
            strokeWidth="1" strokeDasharray="3 5" strokeLinecap="round" />
          <circle className="nf-stray" cx="304" cy="72" r="18" fill="url(#nf-spark)" />
          <circle className="nf-stray" cx="304" cy="72" r="4.5" fill="#fff" />
        </svg>
      </div>
    </div>
  );
};

export default NotFound;
