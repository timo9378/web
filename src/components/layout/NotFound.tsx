import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LocaleLink } from '@/i18n/locale-link';
import { openCommandPalette } from '@/store/commandPaletteStore';
import './NotFound.css';

/**
 * 404 頁。
 *
 * 兩個決定：
 *
 * 1. **主角是那句話，不是那個數字。** 404 只是個狀態碼，讀者需要知道的是
 *    「這裡沒有東西、接下來能去哪」。所以數字縮成一行小小的 eyebrow，
 *    訊息用大字。
 *
 * 2. **給搜尋，不只給連結。** 404 最常見的來源是舊連結與打錯字，這兩種人都
 *    「知道自己要找什麼」——直接丟他回首頁等於要他從頭再找一次。站上本來就有
 *    命令面板（⌘K），這裡把它接上，手機也按得到（見 store/commandPaletteStore.ts）。
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
        <p className="nf-eyebrow">
          <span className="nf-dot" aria-hidden="true" />
          404 · {t('notFound.pageTitleShort')}
        </p>

        {/* ⚠ 必須是 <h1>。少了一級標題 axe 的 page-has-heading-one 會紅，
            而這一頁在 /ja/blog/1 之類沒有該語系版本的路徑上也會渲染，
            所以那條 a11y 測試真的走得到這裡。 */}
        <h1 className="nf-title">{t('notFound.lostMessage')}</h1>
        <p className="nf-sub">{t('notFound.subMessage')}</p>

        <div className="nf-addr">
          <span className="nf-addr-label">{t('notFound.requested')}</span>
          {/* 路徑可能很長（有人會貼一整串），讓它換行而不是撐破版面 */}
          <code className="nf-addr-path">{pathname}</code>
        </div>

        <div className="nf-actions">
          <button type="button" className="nf-btn nf-btn--primary" onClick={openCommandPalette}>
            {t('notFound.search')}
            <kbd className="nf-kbd">⌘K</kbd>
          </button>
          <LocaleLink to="/" className="nf-btn">{t('notFound.backHome')}</LocaleLink>
          <LocaleLink to="/blog" className="nf-btn">{t('nav.notes')}</LocaleLink>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
