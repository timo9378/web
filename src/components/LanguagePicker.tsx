import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { FaGlobe, FaCheck } from 'react-icons/fa';
import { LOCALE_LABELS, stripLocalePrefix } from '../start-i18n';
import { SUPPORTED_LOCALES, LOCALE_PREFIX, type Locale } from '../lib/locales';
import './LanguagePicker.css';

/* ──────────────────────────────────────────────────────────────
   語言切換器 — footer 用，Innei 風 popup
   - trigger: 🌐 + 當前語系 label
   - popup: 5 個 locale，當前打勾
   - 切完寫 localStorage（i18next-browser-languagedetector 自動處理 koim_locale）
   - ⚠ 一定要「導航到帶前綴的網址」而不是只 changeLanguage：頁面內容由 LocaleProvider
     依 **URL** 建的獨立 i18n instance 驅動（見 start-i18n 的 createI18n/LocaleProvider），
     只呼叫 changeLanguage 只會換到外殼那顆 instance → 內容（含今日訊號）不會跟著換。
─────────────────────────────────────────────────────────────── */

function LanguagePicker() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // 點外面關掉 + Esc 關掉
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const current = i18n.resolvedLanguage ?? i18n.language ?? 'zh-TW';

  const select = (code: string) => {
    void i18n.changeLanguage(code); // 記住偏好（localStorage），並讓外殼即時反應
    setOpen(false);
    // 同一個邏輯路徑換前綴：'/en/blog/39' + ja → '/ja/blog/39'；預設語系無前綴。
    const base = stripLocalePrefix(pathname);
    const prefix = LOCALE_PREFIX[code as Locale];
    const target = `/${[prefix, base].filter(Boolean).join('/')}`;
    if (target !== pathname) void navigate({ href: target });
  };

  return (
    <div className="lang-picker" ref={ref}>
      <button
        type="button"
        className="lang-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <FaGlobe className="lang-picker-icon" />
        <span>{LOCALE_LABELS[current] || current}</span>
      </button>

      {/* 不用 role="listbox"/"option"：那組 role 承諾的是完整 listbox 鍵盤語意
          （方向鍵移動 + aria-activedescendant），這裡並沒有實作；而且 role="option"
          蓋在 button 上會覆寫按鈕語意。ul > li > button 本身就正確——報讀器會念
          「清單，5 個項目」→「繁體中文，按鈕」，目前語言用 aria-current 標示。 */}
      {open && (
        <ul className="lang-picker-popup">
          {SUPPORTED_LOCALES.map((code) => (
            <li key={code}>
              <button
                type="button"
                className={`lang-picker-item${code === current ? ' is-current' : ''}`}
                onClick={() => select(code)}
                aria-current={code === current ? 'true' : undefined}
              >
                <span lang={code}>{LOCALE_LABELS[code]}</span>
                {code === current && <FaCheck className="lang-picker-check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LanguagePicker;
