import { useTranslation } from 'react-i18next';
import { LocaleLink } from '@/i18n/locale-link';
import './NotFound.css';

/**
 * 404 頁。
 *
 * 場景是手寫的 SVG（構圖見 NotFound.css 的檔頭）。整個 `<svg>` 掛 `aria-hidden`——
 * 它是純裝飾，真正的訊息在底下的文字裡。給它 alt 之類的東西只會讓螢幕閱讀器
 * 在「找不到頁面」之前先唸一段太空人的描述。
 */
const NotFound = () => {
  const { t } = useTranslation();

  return (
    <div className="nf-wrap">
      <svg className="nf-scene" viewBox="0 0 480 250" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="nf-suit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f5fb" />
            <stop offset="1" stopColor="#b9bed4" />
          </linearGradient>
          <linearGradient id="nf-visor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2b3358" />
            <stop offset="0.55" stopColor="#7f5af0" stopOpacity="0.85" />
            <stop offset="1" stopColor="#2cb67d" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id="nf-accent" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7f5af0" />
            <stop offset="1" stopColor="#2cb67d" />
          </linearGradient>
        </defs>

        {/* ── 星座連線：放在兩側角落並刻意超出畫面，暗示場景比視窗大 ── */}
        <g className="nf-constellation" stroke="rgba(255,255,255,.5)" strokeWidth="1" strokeLinecap="round">
          <path d="M14 34 L46 20 L78 38 L110 16" />
          <path d="M46 20 L54 54" />
          <g fill="#fff">
            <circle cx="14" cy="34" r="2" /><circle cx="46" cy="20" r="2.6" />
            <circle cx="78" cy="38" r="2" /><circle cx="110" cy="16" r="1.8" />
            <circle cx="54" cy="54" r="1.8" />
          </g>
        </g>
        <g className="nf-constellation nf-constellation--b" stroke="rgba(255,255,255,.45)" strokeWidth="1" strokeLinecap="round">
          <path d="M396 176 L428 158 L466 172 L448 208" />
          <path d="M428 158 L422 124" />
          <g fill="#fff">
            <circle cx="396" cy="176" r="1.8" /><circle cx="428" cy="158" r="2.4" />
            <circle cx="466" cy="172" r="1.8" /><circle cx="448" cy="208" r="2" />
            <circle cx="422" cy="124" r="1.6" />
          </g>
        </g>

        {/* ── 「找不到座標」的螢幕 ──
            擺在左半邊：跟太空人分開，否則頭盔會壓住 LOCATION NOT FOUND 那行字。 */}
        <g transform="translate(40 52)">
          <rect x="0" y="0" width="128" height="80" rx="9" fill="rgba(10,12,28,.92)" stroke="rgba(127,90,240,.55)" />
          {/* 簡化的陸塊，只為了讓它讀起來像一張地圖 */}
          <g fill="rgba(255,255,255,.09)">
            <path d="M15 27 q11 -9 24 -3 t19 7 -13 13 -22 2 -8 -19Z" />
            <path d="M68 40 q13 -11 28 -4 t15 13 -19 9 -24 -18Z" />
          </g>
          <path className="nf-route" d="M24 54 q28 -28 56 -9" stroke="#ff6b6b" strokeWidth="1.6" strokeLinecap="round" />
          <g stroke="#ff6b6b" strokeWidth="2.2" strokeLinecap="round">
            <path d="M76 39 l11 11 M87 39 l-11 11" />
          </g>
          <circle cx="24" cy="54" r="2.8" fill="#2cb67d" />
          <text x="64" y="71" textAnchor="middle" fontSize="7.5" letterSpacing="0.7"
            fill="rgba(255,255,255,.5)" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
            LOCATION NOT FOUND
          </text>
        </g>

        {/* ── 漂浮的書：分散在三個角落，不要擠在同一側 ── */}
        <g className="nf-book" transform="translate(150 186)">
          <rect x="-18" y="-13" width="36" height="26" rx="3" fill="#3b3357" stroke="rgba(255,255,255,.28)" />
          <path d="M0 -13 V13" stroke="rgba(255,255,255,.32)" />
          <path d="M-13 -6 H-4 M-13 0 H-5" stroke="rgba(255,255,255,.24)" strokeLinecap="round" />
        </g>
        <g className="nf-book nf-book--b" transform="translate(408 62)">
          <rect x="-16" y="-12" width="32" height="24" rx="3" fill="#4a2f4d" stroke="rgba(255,255,255,.28)" />
          <path d="M0 -12 V12" stroke="rgba(255,255,255,.32)" />
          <path d="M4 -5 H12 M4 1 H11" stroke="rgba(255,255,255,.24)" strokeLinecap="round" />
        </g>
        <g className="nf-book nf-book--c" transform="translate(56 168)">
          <rect x="-14" y="-11" width="28" height="22" rx="3" fill="#2f3f5c" stroke="rgba(255,255,255,.24)" />
          <path d="M0 -11 V11" stroke="rgba(255,255,255,.3)" />
        </g>

        {/* ── 太空人：右半邊，跟螢幕之間用繫繩連起來 ── */}
        <g className="nf-astronaut">
          {/* 繫繩：從腰際拉向螢幕，把兩個元素綁成同一件事 */}
          <path d="M286 178 q-52 30 -110 -6" stroke="rgba(255,255,255,.3)" strokeWidth="1.6" strokeLinecap="round" />

          {/* 背包（露在身體後面一點） */}
          <rect x="286" y="120" width="44" height="48" rx="13" fill="#8f96b3" />
          {/* 手臂：先畫，讓身體壓在上面，肩膀才不會有接縫 */}
          <rect x="256" y="130" width="30" height="16" rx="8" fill="#c9cee0" transform="rotate(-22 271 138)" />
          <rect x="330" y="130" width="30" height="16" rx="8" fill="#c9cee0" transform="rotate(22 345 138)" />
          {/* 腿 */}
          <rect x="292" y="168" width="17" height="32" rx="8.5" fill="#c9cee0" transform="rotate(-9 300 184)" />
          <rect x="313" y="168" width="17" height="32" rx="8.5" fill="#c9cee0" transform="rotate(9 321 184)" />
          {/* 身體 */}
          <rect x="280" y="124" width="56" height="56" rx="18" fill="url(#nf-suit)" />
          {/* 胸前的控制面板 */}
          <rect x="294" y="140" width="28" height="18" rx="4" fill="#2b3358" />
          <circle cx="301" cy="149" r="2.4" fill="#2cb67d" />
          <circle cx="310" cy="149" r="2.4" fill="#ff6b6b" />
          {/* 腰上的識別條 */}
          <rect x="280" y="166" width="56" height="4.5" rx="2.25" fill="url(#nf-accent)" opacity=".9" />
          {/* 頭盔 */}
          <circle cx="308" cy="94" r="33" fill="url(#nf-suit)" />
          <circle cx="308" cy="94" r="25.5" fill="url(#nf-visor)" />
          {/* 面罩上的反光 */}
          <path d="M295 83 q9 -9 20 -4" stroke="rgba(255,255,255,.55)" strokeWidth="3.2" strokeLinecap="round" />
        </g>
      </svg>

      <h1 className="nf-code">404</h1>
      <p className="nf-lead">
        {t('notFound.lostMessage')}
        <br />
        {t('notFound.subMessage')}
      </p>

      <div className="nf-actions">
        <LocaleLink to="/" className="nf-btn nf-btn--primary">
          ← {t('notFound.backHome')}
        </LocaleLink>
        {/* 第二個出口：404 最常見的來源是舊連結／打錯的網址，而那些人多半是要找文章。
            只給「回首頁」等於要他們自己再找一次。 */}
        <LocaleLink to="/blog" className="nf-btn nf-btn--ghost">
          {t('nav.notes')}
        </LocaleLink>
      </div>
    </div>
  );
};

export default NotFound;
