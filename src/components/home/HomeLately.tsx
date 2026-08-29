// 首頁「動態帶」— 近期文章 / 碎念 / 留言迴聲 / 年度軌跡 / 今日訊號收尾。
// 取代原本的 Contact section（聯絡資訊 hero 與 footer 已足夠），
// 收尾的訊號區塊掛 id="contact" 讓既有錨點（hero CTA / footer / Messages）續用。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LocaleLink } from '@/i18n/locale-link';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { DigestTimeline } from '@koimsurai/api-types';
import { homeDigestQueryOptions, dailyQuoteQueryOptions } from '@/data/homeData';
import './HomeLately.css';
import SiteAppreciation from './SiteAppreciation';
import { useCategoryLabel } from '@/lib/categoryLabel';
import { postPath } from '@/lib/postPath';

/** 相對時間（30 天內），更久就顯示日期 */
function timeAgo(iso: string, t: TFunction) {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 3600) return t('home.lately.justNow');
  if (sec < 86400) return t('home.lately.hoursAgo', { n: Math.floor(sec / 3600) });
  if (sec < 86400 * 30) return t('home.lately.daysAgo', { n: Math.floor(sec / 86400) });
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 年度軌跡：依「月份」分組。每月一個群組節點（大小 ∝ 篇數、點擊區 ≥24px → 過 a11y target-size），
 *  hover / 點擊 / focus 冒出當月文章標題清單（可點）。取代舊「每篇一個 7px 點」的做法。 */
function OrbitTimeline({ timeline, t, locale }: { timeline: DigestTimeline[]; t: TFunction; locale: string }) {
  const [openMonth, setOpenMonth] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );
  const openNow = (m: number) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenMonth(m);
  };
  const closeSoon = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpenMonth(null), 160);
  };

  // 「今」的位置只算一次（new Date() 不能在 render 期直接呼叫 → 放 state initializer）。
  const [now] = useState(() => new Date());
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearSpan = new Date(year + 1, 0, 1).getTime() - yearStart;
  /** 一年之中的位置（0~100%）。用實際毫秒算，所以各月的寬度是真的（2 月窄、8 月寬）。 */
  const pct = (ms: number) => ((ms - yearStart) / yearSpan) * 100;

  // 依月份（0-11）分組，只留有文章的月份；每篇連結仍可點（在清單裡）。
  const byMonth = new Map<number, DigestTimeline[]>();
  for (const p of timeline) {
    const m = new Date(String(p.created_at).replace(' ', 'T')).getMonth();
    const arr = byMonth.get(m);
    if (arr) arr.push(p);
    else byMonth.set(m, [p]);
  }
  const clusters = [...byMonth.entries()].map(([month, posts]) => ({ month, posts })).sort((a, b) => a.month - b.month);
  /** 月份分界（每月 1 號）。m 可以給 12＝隔年 1/1＝100%。 */
  const monthStartPct = (m: number) => pct(new Date(year, m, 1).getTime());
  /** 月份標籤（下方那排 1..12）＝該月正中間。 */
  const monthPct = (m: number) => (monthStartPct(m) + monthStartPct(m + 1)) / 2;
  /**
   * 星球一律放**該月正中間**，跟下方標籤對齊——這張圖是「每月一顆」，星球代表的是
   * 整個月而不是某一天，所以進行中的月份也照樣放月中（就當成當月）。
   *
   * 「今天」那顆北極星則放在**當月與下個月之間的空檔**（見下方 nowMarkPct），
   * 於是它永遠在最新那顆星球右邊、又剛好落在兩顆星球中間，同高度也不會互相蓋住。
   *
   * ⚠ 試過另外兩種都不行，別再走回去：
   *   1. 星球放月中 + 北極星放實際日期 → 月初時北極星在當月星球左邊，看起來像有還沒發生的文章。
   *   2. 星球放該月貼文的平均日期 → 日期最準，但相鄰月份的貼文只差幾天時兩顆會黏在一起
   *      （實際發生過：七月底與八月初的星球疊住），疏密不均、也對不上標籤。
   */
  const clusterPct = (m: number) => monthPct(m);
  /** 北極星＝當月與下個月的正中間（12 月時取到年底）。 */
  const nowMonth = now.getMonth();
  const nowMarkPct = (monthPct(nowMonth) + (nowMonth === 11 ? 100 : monthPct(nowMonth + 1))) / 2;
  const monthName = (m: number) => new Date(2000, m, 1).toLocaleDateString(locale, { month: 'long' });

  return (
    <div className="lately-orbit">
      <h2 className="lately-h">{t('home.lately.orbitTitle')}</h2>
      <div className="orbit-track">
        <div className="orbit-line" />
        {/* 月份分界的細刻線（只畫 2~12 月的月初，頭尾不畫）。標籤在月正中，光看標籤
            分不出「8/4」該落在哪一段——有分界線才讀得出「今天」已經進入八月。 */}
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={`e${i + 1}`}
            className="orbit-month-edge"
            style={{ left: `${monthStartPct(i + 1)}%` }}
            aria-hidden
          />
        ))}
        {Array.from({ length: 12 }, (_, m) => (
          <span key={`m${m}`} className="orbit-month-tick" style={{ left: `${monthPct(m)}%` }}>
            {m + 1}
          </span>
        ))}
        {clusters.map(({ month, posts }) => {
          const open = openMonth === month;
          // 篇數越多的月份，星球越大。
          const size = Math.min(9 + (posts.length - 1) * 2, 18);
          // 星球「種類」依月份固定分配，避免每顆長得一樣：
          // rocky（素球）／ringed（土星環）／banded（氣態巨行星條紋）／icy（亮環帶衛星感）
          const KINDS = ['rocky', 'banded', 'ringed', 'icy'] as const;
          const kind = KINDS[month % KINDS.length];
          // 每個月給不同色相，讓它們看起來是不同的星球（固定值，不隨渲染變）。
          const hue = 200 + ((month * 37) % 120); // 200~320：藍紫～粉紫，貼站上色調
          const label = `${monthName(month)} · ${posts.length}`;
          return (
            <div
              key={month}
              className={open ? 'orbit-month orbit-month--open' : 'orbit-month'}
              style={{ left: `${clusterPct(month)}%` }}
              onMouseEnter={() => openNow(month)}
              onMouseLeave={closeSoon}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setOpenMonth(null);
              }}
            >
              <button
                type="button"
                className="orbit-month-btn"
                aria-label={label}
                aria-expanded={open}
                onClick={() => setOpenMonth(open ? null : month)}
                onFocus={() => openNow(month)}
              >
                <span
                  className={`orbit-month-dot orbit-month-dot--${kind}`}
                  style={{ width: `${size}px`, height: `${size}px`, '--planet-hue': hue } as CSSProperties}
                  aria-hidden
                />
              </button>
              {open && (
                <div className="orbit-month-pop">
                  <div className="orbit-month-pop-head">{label}</div>
                  <ul className="orbit-month-pop-list">
                    {posts.map((p) => (
                      <li key={p.id}>
                        <LocaleLink to={postPath(p)} className="orbit-month-link" onClick={() => setOpenMonth(null)}>
                          {p.title}
                        </LocaleLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {/* 北極星畫在「當月星球」與「下個月」的正中間，不是今天的實際日期。
            實際日期跟當月星球本來就只差幾天，在一年的尺度上只有幾個像素 → 同高度必然疊住。
            放進兩個月的空檔之後，它永遠在最新那顆星球的右邊、兩側都留白，
            不需要靠高低錯開就不會互相蓋住。刻意的取捨，別改回 nowPct。 */}
        <span className="orbit-now" style={{ left: `${nowMarkPct}%` }} data-title={t('home.lately.today')} />
      </div>
      <div className="orbit-stat">
        {t('home.lately.orbitStat', { count: timeline.length })}
        <span className="orbit-stat-dot">·</span>
        <LocaleLink to="/blog" className="lately-more">
          {t('home.lately.viewAll')} →
        </LocaleLink>
      </div>
    </div>
  );
}

export default function HomeLately() {
  const { t, i18n } = useTranslation();
  const categoryLabel = useCategoryLabel();
  // 動態帶 / 每日名言改由 TanStack Query 讀（queryFn 內建 catch 降級，對齊舊 UX）。
  const { data: digest } = useQuery(homeDigestQueryOptions(i18n.resolvedLanguage ?? i18n.language));
  const { data: quote } = useQuery(dailyQuoteQueryOptions(i18n.resolvedLanguage ?? i18n.language));

  // /#contact 深連結：本元件 lazy 掛載比 Header 的 100ms hash 捲動晚，掛載後自己補捲
  useEffect(() => {
    if (digest && window.location.hash === '#contact') {
      requestAnimationFrame(() => {
        document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [digest]);

  const posts = digest?.posts ?? [];
  const thoughts = digest?.thoughts ?? [];
  const comments = digest?.comments ?? [];
  const timeline = digest?.timeline ?? [];

  return (
    <section className="home-section lately-v1">
      <div className="home-section-eyebrow">
        <span className="section-label">Lately</span>
        <span className="section-eyebrow-count">{t('home.lately.eyebrow')}</span>
      </div>

      <div className="lately-grid">
        {/* 左欄：近期文章 */}
        <div className="lately-posts">
          <h2 className="lately-h">{t('home.lately.postsTitle')}</h2>
          {posts.length === 0 && <p className="lately-empty">{t('home.lately.empty')}</p>}
          <ol className="lately-post-list">
            {posts.map((p, i) => (
              <li key={p.id}>
                <LocaleLink to={postPath(p)} className="lately-post">
                  <span className="lately-post-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lately-post-body">
                    <span className="lately-post-title">{p.title}</span>
                    <span className="lately-post-meta">
                      {p.category ? `${categoryLabel(p.category)} · ` : ''}
                      {timeAgo(p.created_at, t)}
                    </span>
                  </span>
                </LocaleLink>
              </li>
            ))}
          </ol>
        </div>

        {/* 右欄：碎念 + 迴聲 */}
        <aside className="lately-side">
          <div className="lately-block">
            <h2 className="lately-h">
              {t('home.lately.murmursTitle')}
              <LocaleLink to="/thinking" className="lately-more lately-h-more">
                {t('home.lately.more')} →
              </LocaleLink>
            </h2>
            {thoughts.length === 0 && <p className="lately-empty">{t('home.lately.empty')}</p>}
            <ul className="lately-murmurs">
              {thoughts.map((th) => (
                <li key={th.id}>
                  <LocaleLink to={`/thinking/${th.id}`} className="lately-murmur">
                    <p className="lately-murmur-text">「{th.content}」</p>
                    <span className="lately-post-meta">{timeAgo(th.created_at, t)}</span>
                  </LocaleLink>
                </li>
              ))}
            </ul>
          </div>

          <div className="lately-divider" />

          <div className="lately-block">
            <h2 className="lately-h">{t('home.lately.echoesTitle')}</h2>
            {comments.length === 0 && <p className="lately-empty">{t('home.lately.empty')}</p>}
            <ul className="lately-echoes">
              {comments.map((c) => (
                <li key={c.id}>
                  <LocaleLink
                    to={c.thought_id ? `/thinking/${c.thought_id}` : `/blog/${c.post_id}`}
                    className="lately-echo"
                  >
                    <p className="lately-echo-text">{c.content}</p>
                    <span className="lately-post-meta">
                      — {c.author}
                      {c.post_title ? ` · ${c.post_title}` : ''}
                    </span>
                  </LocaleLink>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <OrbitTimeline timeline={timeline} t={t} locale={i18n.resolvedLanguage ?? i18n.language} />

      {/* 今日訊號 — 詩意收尾，承接 #contact 錨點 */}
      <div className="lately-signal" id="contact">
        <span className="section-label signal-label">{t('home.signal.label')}</span>
        {quote && (
          <>
            <blockquote className="signal-quote">「{quote.text}」</blockquote>
            {quote.from && <span className="signal-from">— {quote.from}</span>}
          </>
        )}
        <div className="signal-contact">
          <span className="signal-dot" />
          {t('home.signal.open')}
          <span className="orbit-stat-dot">·</span>
          <a href="mailto:timo9378@gmail.com" className="signal-mail">
            timo9378@gmail.com
          </a>
        </div>
        <SiteAppreciation />
      </div>
    </section>
  );
}
