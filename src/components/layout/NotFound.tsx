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
 * 置中的大字 404，**中間那個 0 是土星**——不是隨便挑一顆行星：首頁的 3D 場景主角
 * 就是土星（見 lib/starfieldGpu.ts），拿它當 0 這一頁才長得像這個站的東西，
 * 而不是任何一張現成的太空 404 模板。
 *
 * 旁邊一位飄走的太空人，後面拖一條虛線的軌跡，從土星環那裡一路甩出去。
 *
 * ⚠ **不畫星星。** 全站的太空背景（SpaceBackdropShell）就在後面跑，再鋪一層
 *   星點密度會變兩倍、而且視差對不上——那是這一頁前幾版就踩過的。
 *   這裡只加「近景」：土星、太空人、軌跡。
 *
 * ## 無障礙
 *
 * 大字 404 是圖像（數字被拆成兩個 span 中間夾一個 SVG，螢幕閱讀器唸起來是
 * 「四、四」），所以整組 `aria-hidden`，另外給一段只有輔助技術讀得到的文字。
 * `<h1>` 是那句訊息——少了一級標題 axe 的 `page-has-heading-one` 會紅，
 * 而這一頁在 `/ja/blog/1` 之類沒有該語系版本的路徑上真的會被渲染到。
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
        <span className="nf-sr">404</span>

        <div className="nf-code" aria-hidden="true">
          <span className="nf-digit">4</span>

          <svg className="nf-saturn" viewBox="0 0 200 200" fill="none">
            <defs>
              <radialGradient id="nf-planet" cx="0.35" cy="0.3" r="0.85">
                <stop offset="0" stopColor="#a78bfa" />
                <stop offset="0.55" stopColor="#7f5af0" />
                <stop offset="1" stopColor="#3b2a7a" />
              </radialGradient>
              <linearGradient id="nf-ring" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#2cb67d" stopOpacity="0.35" />
                <stop offset="0.5" stopColor="#e0c3fc" stopOpacity="0.95" />
                <stop offset="1" stopColor="#7f5af0" stopOpacity="0.4" />
              </linearGradient>
              {/* 環的後半段要被星球擋住：用遮罩挖掉星球那一塊 */}
              <mask id="nf-ring-back">
                <rect width="200" height="200" fill="#fff" />
                <circle cx="100" cy="100" r="52" fill="#000" />
              </mask>
            </defs>

            {/* 環的後半（先畫，被星球蓋住上緣） */}
            <ellipse
              cx="100"
              cy="100"
              rx="92"
              ry="26"
              stroke="url(#nf-ring)"
              strokeWidth="6"
              transform="rotate(-18 100 100)"
              opacity=".75"
            />
            {/* 星球 */}
            <circle cx="100" cy="100" r="52" fill="url(#nf-planet)" />
            {/* 表面的帶狀紋理，讓它不是一顆純色球 */}
            <path d="M52 88 q48 -14 96 0" stroke="rgba(255,255,255,.16)" strokeWidth="5" strokeLinecap="round" />
            <path d="M56 114 q44 12 88 -2" stroke="rgba(0,0,0,.18)" strokeWidth="7" strokeLinecap="round" />
            {/* 環的前半（畫在星球之上，只留下半段） */}
            <ellipse
              cx="100"
              cy="100"
              rx="92"
              ry="26"
              stroke="url(#nf-ring)"
              strokeWidth="6"
              transform="rotate(-18 100 100)"
              mask="url(#nf-ring-back)"
            />
          </svg>

          <span className="nf-digit">4</span>
        </div>

        {/* 太空人與他甩出去的軌跡。放在 code 之後、用絕對定位疊上去，
            這樣它可以壓在數字上而不影響版面高度。 */}
        <svg className="nf-astro" viewBox="0 0 260 200" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="nf-suit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#b9bed4" />
            </linearGradient>
            <linearGradient id="nf-visor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2b3358" />
              <stop offset="0.6" stopColor="#7f5af0" stopOpacity="0.9" />
              <stop offset="1" stopColor="#2cb67d" stopOpacity="0.75" />
            </linearGradient>
          </defs>

          {/* 軌跡：從左下甩上來，帶一個迴圈——照參考圖那種「飄走」的感覺 */}
          <path
            className="nf-trail"
            d="M4 190 q70 -6 96 -52 t-30 -46 q-14 24 22 30 t70 -30"
            stroke="rgba(255,255,255,.45)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="1 9"
          />

          <g className="nf-astro-body" transform="translate(178 46) rotate(14)">
            {/* 背包 */}
            <rect x="14" y="30" width="34" height="38" rx="11" fill="#8f96b3" />
            {/* 四肢先畫，身體壓在上面，肩膀才沒有接縫 */}
            <rect x="-6" y="38" width="26" height="13" rx="6.5" fill="#c9cee0" transform="rotate(-28 7 44)" />
            <rect x="42" y="38" width="26" height="13" rx="6.5" fill="#c9cee0" transform="rotate(26 55 44)" />
            <rect x="14" y="66" width="14" height="28" rx="7" fill="#c9cee0" transform="rotate(-12 21 80)" />
            <rect x="32" y="66" width="14" height="28" rx="7" fill="#c9cee0" transform="rotate(16 39 80)" />
            {/* 身體 */}
            <rect x="10" y="32" width="42" height="44" rx="15" fill="url(#nf-suit)" />
            {/* 胸前面板 */}
            <rect x="21" y="44" width="20" height="14" rx="4" fill="#2b3358" />
            <circle cx="27" cy="51" r="2" fill="#2cb67d" />
            <circle cx="35" cy="51" r="2" fill="#ff6b6b" />
            {/* 腰帶 */}
            <rect x="10" y="64" width="42" height="4" rx="2" fill="#7f5af0" opacity=".85" />
            {/* 頭盔 */}
            <circle cx="31" cy="16" r="25" fill="url(#nf-suit)" />
            <circle cx="31" cy="16" r="19" fill="url(#nf-visor)" />
            <path d="M21 8 q7 -7 15 -3" stroke="rgba(255,255,255,.6)" strokeWidth="3" strokeLinecap="round" />
          </g>
        </svg>

        {/* ⚠ 必須是 <h1>，理由見檔頭。 */}
        <h1 className="nf-title">{t('notFound.lostMessage')}</h1>
        <p className="nf-sub">{t('notFound.subMessage')}</p>

        <p className="nf-addr">
          <span className="nf-addr-label">{t('notFound.requested')}</span>
          <code className="nf-addr-path">{pathname}</code>
        </p>

        <div className="nf-actions">
          <button type="button" className="nf-btn" onClick={openCommandPalette}>
            {t('notFound.search')}
            <kbd className="nf-kbd">⌘K</kbd>
          </button>
          {/* 次要動作用文字連結而不是第二、第三顆按鈕——三顆一樣的矩形沒有主次 */}
          <LocaleLink to="/" className="nf-link">
            {t('notFound.backHome')}
            <span className="nf-arrow" aria-hidden="true">
              →
            </span>
          </LocaleLink>
          <LocaleLink to="/blog" className="nf-link">
            {t('nav.notes')}
            <span className="nf-arrow" aria-hidden="true">
              →
            </span>
          </LocaleLink>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
