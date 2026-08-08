import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LocaleLink } from '@/i18n/locale-link';
import './NotFound.css';

/**
 * 404 頁。
 *
 * 構圖是「一張漂在星海裡的紙條」，不是置中的大字報——理由見 NotFound.css 的檔頭。
 *
 * 唯一有功能性的新東西是**把使用者要找的路徑印出來**。404 最常見的來源是打錯字
 * 或舊連結，而讀者通常不會去看網址列；把它寫在紙條上，他自己就看得出來是
 * 少了一段、還是整頁真的沒了。
 */
const NotFound = () => {
  const { t } = useTranslation();
  // 只取 pathname：query 可能帶 token 之類的東西，印在畫面上沒有必要
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="nf-wrap">
      <div className="nf-card">
        {/* 紙膠帶。純裝飾，不進無障礙樹 */}
        <span className="nf-tape" aria-hidden="true" />

        {/* ⚠ 必須是 <h1>。改成 <p> 的話整頁就沒有一級標題，axe 的
            `page-has-heading-one` 會紅——這條真的擋下過（見 a11y.spec.ts）。
            版面上它看起來只是個數字，但它就是這一頁的標題。 */}
        <h1 className="nf-code">404</h1>

        <p className="nf-message">
          {t('notFound.lostMessage')}
          <br />
          {t('notFound.subMessage')}
        </p>

        <hr className="nf-rule" />

        <p className="nf-label">{t('notFound.requested')}</p>
        {/* 路徑可能很長（有人會貼一整串），用 wrap-anywhere 讓它換行而不是撐破卡片 */}
        <p className="nf-path">{pathname}</p>

        <nav className="nf-actions">
          <LocaleLink to="/" className="nf-link">
            <span className="nf-mark" aria-hidden="true" />
            {t('notFound.backHome')}
          </LocaleLink>
          {/* 第二個出口：從舊連結進來的人多半是要找文章，只給「回首頁」
              等於要他們自己再找一次 */}
          <LocaleLink to="/blog" className="nf-link">
            <span className="nf-mark" aria-hidden="true" />
            {t('nav.notes')}
          </LocaleLink>
        </nav>

        <p className="nf-signature">{t('notFound.signature')}</p>
      </div>
    </div>
  );
};

export default NotFound;
