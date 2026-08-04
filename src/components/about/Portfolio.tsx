import { useRef } from 'react';
import { motion } from 'framer-motion';
import { LocaleLink } from '@/i18n/locale-link';
import { useTranslation } from 'react-i18next';
import photoMainImage from '@/assets/Photo-main.webp';
import './Portfolio.css';
import { lookupOr } from '@/lib/tableLookup';

interface FeatText { category: string; status: string; title: string; desc: string; linkLabel: string }
interface DictEntry {
  pageTitle: string;
  pageSub: string;
  feat: FeatText;
  titles: Record<number, string>;
  descs: Record<number, string>;
  viewSource: string;
  viewAlbum: string;
}
interface SecondaryStatic {
  id: number;
  category: string;
  videoUrl?: string;
  imageUrl?: string;
  glyph?: string;
  link: string;
  external: boolean;
  secondaryLink?: string;
  secondaryLabel?: string;
  tags: string[];
  linkKey?: 'viewSource' | 'viewAlbum';
  linkLabel?: string;
}

// 翻譯字典：feature description + section labels (Repo 名稱英文不翻)
const I18N: Record<string, DictEntry> = {
  'zh-TW': {
    pageTitle: '作品', pageSub: '做過的、正在做的——專題、工具與自架服務。',
    feat: { category: 'App Development · 專題', status: 'In Progress', title: 'VoltiCar — 碳權電動車 App', desc: '結合碳權概念、電動車充電資訊與遊戲化元素的 App，目標是用便捷與趣味互動鼓勵綠色能源行動。NTUST IM·IoV 專題系列，包含 Android client、Spring Boot API、Discord Bot 三個 repo。', linkLabel: '▶ 觀看介紹影片' },
    titles: { 2: '個人形象網站（本站）', 3: '個人攝影集錦', 4: 'flow2code', 5: 'Finbox — 自動記帳 App', 8: 'fakeGPS', 6: 'Pulmote', 7: 'Koimsurai-NAS' },
    descs: { 2: '使用 React、Vite 與 CSS 打造，Framer Motion 動效與 Canvas 蟲洞 intro。', 3: '包含多張個人攝影作品，點擊查看詳情。', 4: '基於 AST 的視覺化後端邏輯產生器 — 拖拉流程圖節點即可生成可執行程式碼。', 5: '抓 Gmail 通知判斷月訂閱與一次性消費，自動歸類進收支記帳。動機很單純：訂閱多到 Play 商店訂閱管理抓不到，乾脆自己寫一個。', 8: '小工具，模擬 GPS 定位。實作很簡單但意外好用。怎麼用就… 自己想想 :)', 6: 'ESP32 紅外線遙控模擬器與 WiFi bridge — 把舊家電通通接進家庭自動化網路。', 7: '自架 NAS — 自製前端介面 + 自製 backend，整合相簿 / 影音 / 檔案管理。全部跑在家裡那台機器上。' },
    viewSource: '查看原始碼', viewAlbum: '查看相簿',
  },
  'zh-CN': {
    pageTitle: '作品', pageSub: '做过的、正在做的——专题、工具与自架服务。',
    feat: { category: 'App Development · 毕业专题', status: 'In Progress', title: 'VoltiCar — 碳权电动车 App', desc: '结合碳权概念、电动车充电资讯与游戏化元素的 App，目标是用便捷与趣味互动鼓励绿色能源行动。NTUST IM·IoV 专题系列，包含 Android client、Spring Boot API、Discord Bot 三个 repo。', linkLabel: '▶ 观看介绍视频' },
    titles: { 2: '个人形象网站（本站）', 3: '个人摄影集锦', 4: 'flow2code', 5: 'Finbox — 自动记账 App', 8: 'fakeGPS', 6: 'Pulmote', 7: 'Koimsurai-NAS' },
    descs: { 2: '使用 React、Vite 与 CSS 打造，Framer Motion 动效与 Canvas 虫洞 intro。', 3: '包含多张个人摄影作品，点击查看详情。', 4: '基于 AST 的可视化后端逻辑生成器 — 拖拉流程图节点即可生成可执行程式码。', 5: '抓 Gmail 通知判断月订阅与一次性消费，自动归类进收支记账。动机很单纯：订阅多到 Play 商店订阅管理抓不到，干脆自己写一个。', 8: '小工具，模拟 GPS 定位。实作很简单但意外好用。怎么用就… 自己想想 :)', 6: 'ESP32 红外线遥控模拟器与 WiFi bridge — 把旧家电通通接进家庭自动化网络。', 7: '自架 NAS — 自制前端介面 + 自制 backend，整合相簿 / 影音 / 档案管理。全部跑在家里那台机器上。' },
    viewSource: '查看源码', viewAlbum: '查看相簿',
  },
  en: {
    pageTitle: 'Projects', pageSub: 'Things built and being built — capstones, tools, self-hosted services.',
    feat: { category: 'App Development · Capstone', status: 'In Progress', title: 'VoltiCar — Carbon-credit EV App', desc: 'An app combining carbon credits, EV charging info, and gamification — designed to nudge users toward green-energy actions through convenience and play. NTUST IM·IoV capstone project, with Android client, Spring Boot API, and a Discord Bot.', linkLabel: '▶ Watch intro video' },
    titles: { 2: 'Personal site (this site)', 3: 'Photography portfolio', 4: 'flow2code', 5: 'Finbox — auto-bookkeeping app', 8: 'fakeGPS', 6: 'Pulmote', 7: 'Koimsurai-NAS' },
    descs: { 2: 'Built with React, Vite and CSS — with Framer Motion effects and a Canvas wormhole intro.', 3: 'A collection of my photography. Click to view full set.', 4: 'AST-based visual backend logic generator — drag flowchart nodes and it spits out runnable code.', 5: 'Scrapes Gmail notifications to identify recurring subscriptions and one-off purchases, auto-classifies them in the ledger. The motivation was simple: I had too many subscriptions for Play Store to track, so I built one.', 8: 'Tiny utility to fake GPS location. Trivially built, surprisingly useful. How you use it… is up to you :)', 6: 'ESP32 IR remote emulator + WiFi bridge — bring legacy appliances into your home automation network.', 7: 'Self-hosted NAS — custom frontend + custom backend, with photo/media/file management. All running on the box at home.' },
    viewSource: 'View source', viewAlbum: 'View album',
  },
  ja: {
    pageTitle: '作品', pageSub: '作ったもの・作っているもの——課題、ツール、セルフホスト。',
    feat: { category: 'App 開発 · 卒業課題', status: 'In Progress', title: 'VoltiCar — カーボンクレジット EV アプリ', desc: 'カーボンクレジット、EV 充電情報、ゲーミフィケーションを組み合わせたアプリ。便利さと楽しさで、グリーンエネルギー行動を促すことを目指しています。NTUST IM·IoV 卒業課題で、Android クライアント・Spring Boot API・Discord Bot の 3 リポジトリ構成。', linkLabel: '▶ 紹介動画を見る' },
    titles: { 2: '個人サイト（このサイト）', 3: '写真ポートフォリオ', 4: 'flow2code', 5: 'Finbox — 自動家計簿アプリ', 8: 'fakeGPS', 6: 'Pulmote', 7: 'Koimsurai-NAS' },
    descs: { 2: 'React・Vite・CSS で構築。Framer Motion のアニメーションと Canvas のワームホールイントロ付き。', 3: '個人撮影作品をまとめたもの。クリックで詳細を表示。', 4: 'AST ベースのビジュアルなバックエンドロジック生成ツール。フローチャートをドラッグすれば実行可能なコードを吐く。', 5: 'Gmail の通知から月額サブスクと単発購入を判別し、家計簿に自動分類。サブスクが多すぎて Play ストアでも管理しきれなかったので、自分で作った。', 8: 'GPS 位置を偽装する小さなツール。実装は簡単だが意外と便利。使い道は… 自分で考えてください :)', 6: 'ESP32 赤外線リモコンエミュレーター + WiFi ブリッジ。古い家電をすべてホームオートメーションにつなぐ。', 7: 'セルフホスト NAS — 自作のフロントエンド + 自作の Backend で、アルバム / 動画 / ファイル管理を統合。すべて家のマシンで稼働。' },
    viewSource: 'ソースを見る', viewAlbum: 'アルバムを見る',
  },
  ko: {
    pageTitle: '프로젝트', pageSub: '만든 것과 만들고 있는 것 — 과제, 도구, 셀프호스팅.',
    feat: { category: '앱 개발 · 졸업과제', status: 'In Progress', title: 'VoltiCar — 탄소 크레딧 전기차 앱', desc: '탄소 크레딧, 전기차 충전 정보, 게이미피케이션을 결합한 앱. 편리함과 재미로 친환경 에너지 행동을 유도하는 것이 목표예요. NTUST IM·IoV 졸업과제로 Android 클라이언트, Spring Boot API, Discord Bot 세 개의 레포지토리로 구성됩니다.', linkLabel: '▶ 소개 영상 보기' },
    titles: { 2: '개인 사이트(이 사이트)', 3: '사진 포트폴리오', 4: 'flow2code', 5: 'Finbox — 자동 가계부 앱', 8: 'fakeGPS', 6: 'Pulmote', 7: 'Koimsurai-NAS' },
    descs: { 2: 'React, Vite, CSS로 제작. Framer Motion 애니메이션과 Canvas 웜홀 인트로 포함.', 3: '개인 사진 작품 모음. 클릭해서 상세 보기.', 4: 'AST 기반 시각화 백엔드 로직 생성기. 플로우차트 노드를 끌어다 놓으면 실행 가능한 코드를 생성해요.', 5: 'Gmail 알림에서 월간 구독과 단발 구매를 구분해 가계부에 자동 분류. 동기는 단순합니다: 구독이 너무 많아 Play 스토어로도 관리가 안 되어서 직접 만들었어요.', 8: 'GPS 위치를 위장하는 작은 도구. 구현은 단순하지만 의외로 유용해요. 어떻게 쓸지는… 알아서 :)', 6: 'ESP32 적외선 리모컨 에뮬레이터 + WiFi 브리지 — 오래된 가전을 모두 홈 오토메이션에 연결.', 7: '셀프호스팅 NAS — 자체 제작 프런트엔드 + 자체 제작 백엔드로 앨범 / 미디어 / 파일 관리를 통합. 모두 집에 있는 서버에서 동작해요.' },
    viewSource: '소스 보기', viewAlbum: '앨범 보기',
  },
};

// FEATURE & SECONDARY 只放穩定欄位（URL、tags、media）；title/desc/linkLabel 從 I18N 動態組
const FEATURE_STATIC = {
  id: 1, imageUrl: 'https://img.youtube.com/vi/eKIJcSIVak0/maxresdefault.jpg', link: 'https://www.youtube.com/watch?v=eKIJcSIVak0', external: true,
  extras: [
    { href: 'https://github.com/ntust-im-iov/VoltiCar', label: 'Android Repo' },
    { href: 'https://github.com/ntust-im-iov/VoltiCar_API', label: 'API Repo' },
    { href: 'https://github.com/ntust-im-iov/Discord-Bot', label: 'Discord Bot' },
  ],
  tags: ['Kotlin', 'Spring Boot', 'PostgreSQL', 'Carbon API'],
};

const SECONDARY_STATIC: SecondaryStatic[] = [
  { id: 2, category: 'Web Development', videoUrl: '/videos/Web_video.mkv', link: 'https://github.com/timo9378/web', external: true, tags: ['React', 'Vite', 'Canvas'], linkKey: 'viewSource' },
  { id: 3, category: 'Photography', imageUrl: photoMainImage, link: '/photos', external: false, tags: ['Lightroom', 'Streetscape', 'Portrait'], linkKey: 'viewAlbum' },
  { id: 4, category: 'Developer Tool', glyph: '⟁', link: 'https://github.com/timo9378/flow2code', external: true, tags: ['AST', 'Visual Programming', 'TypeScript'], linkKey: 'viewSource' },
  { id: 5, category: 'Full-Stack · Mobile', glyph: '$', link: 'https://github.com/timo9378/Finbox', external: true, secondaryLink: 'https://github.com/timo9378/finbox-backend', secondaryLabel: 'Backend Repo', tags: ['Mobile', 'Gmail API', 'Node.js'], linkLabel: 'Frontend Repo' },
  { id: 8, category: 'Tool', glyph: '⊙', link: 'https://github.com/timo9378/fakeGPS', external: true, tags: ['Android', 'Location Mock'], linkKey: 'viewSource' },
  { id: 6, category: 'IoT / Embedded', glyph: '↯', link: 'https://github.com/timo9378/Pulmote', external: true, tags: ['ESP32', 'C++', 'MQTT', 'IR'], linkKey: 'viewSource' },
  { id: 7, category: 'Self-hosted · Full-Stack', glyph: '◰', link: 'https://github.com/timo9378/Koimsurai-NAS', external: true, secondaryLink: 'https://github.com/timo9378/Koimsurai-NAS-backend', secondaryLabel: 'Backend Repo', tags: ['React', 'Vite', 'Node.js', 'Self-hosted'], linkLabel: 'Frontend Repo' },
];

/* 影片封面：拿掉原生控制列（chrome 很破壞排版），hover 進場才播、離開暫停 */
const HoverVideo = ({ src }: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      onMouseEnter={() => { void ref.current?.play().catch(() => { /* ignore autoplay block */ }); }}
      onMouseLeave={() => { ref.current?.pause(); }}
    />
  );
};

const ProjectLink = ({ item }: { item: { link?: string; external?: boolean; linkLabel?: string } }) => {
  if (!item.link) return null;
  if (item.external) {
    return (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="portfolio-link"
      >
        {item.linkLabel}
      </a>
    );
  }
  return <LocaleLink to={item.link} className="portfolio-link">{item.linkLabel}</LocaleLink>;
};

const Portfolio = () => {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const dict = lookupOr(I18N, lang, I18N['zh-TW']);
  const FEATURE = { ...FEATURE_STATIC, category: dict.feat.category, status: dict.feat.status, title: dict.feat.title, description: dict.feat.desc, linkLabel: dict.feat.linkLabel };
  const SECONDARY = SECONDARY_STATIC.map((it) => ({
    ...it,
    title: dict.titles[it.id],
    description: dict.descs[it.id],
    linkLabel: it.linkLabel ?? (it.linkKey ? dict[it.linkKey] : ''),
  }));
  return (
  <div className="portfolio-page">
  {/* 前景濾鏡：壓暗亮星空，跟 /watch /thinking 一致 */}
  <div className="portfolio-scrim" />
  <section id="portfolio" className="home-section portfolio-v2">
    <div className="home-section-eyebrow">
      <span className="section-label">Selected Work</span>
      <span className="section-eyebrow-count">{1 + SECONDARY.length} projects</span>
    </div>
    <h1 className="section-hero-title portfolio-page-title">{dict.pageTitle}</h1>
    <p className="portfolio-page-sub">{dict.pageSub}</p>

    <motion.article
      className="portfolio-feature glass-card"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="portfolio-feature-media">
        <img
          src={FEATURE.imageUrl}
          alt={FEATURE.title}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="portfolio-feature-body">
        <div className="portfolio-feature-meta">
          <span className="section-label">{FEATURE.category}</span>
          <span className="portfolio-status">{FEATURE.status}</span>
        </div>
        {/* h2 不是 h3：頁面標題是 h1，中間沒有其他層級，h3 會跳級（axe: heading-order）。
            下面的次要作品跟著從 h4 降成 h3。class 都保留，樣式不動。 */}
        <h2 className="portfolio-feature-title">{FEATURE.title}</h2>
        <p className="portfolio-feature-desc">{FEATURE.description}</p>
        <div className="portfolio-tags">
          {FEATURE.tags.map((t) => (
            <span key={t} className="portfolio-tag">{t}</span>
          ))}
        </div>
        <div className="portfolio-links">
          <ProjectLink item={FEATURE} />
          {FEATURE.extras.map((ex) => (
            <a
              key={ex.href}
              href={ex.href}
              target="_blank"
              rel="noopener noreferrer"
              className="portfolio-link portfolio-link--secondary"
            >
              {ex.label}
            </a>
          ))}
        </div>
      </div>
    </motion.article>

    <div className="portfolio-secondary-grid">
      {SECONDARY.map((item, i) => {
        const hasMedia = !!(item.videoUrl ?? item.imageUrl);
        return (
        <motion.article
          key={item.id}
          className={`portfolio-secondary glass-card${hasMedia ? '' : ' portfolio-secondary--code'}`}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: 'easeOut' }}
        >
          {hasMedia ? (
            <div className="portfolio-secondary-media">
              {item.videoUrl ? (
                <HoverVideo src={item.videoUrl} />
              ) : (
                <img src={item.imageUrl} alt={item.title} loading="lazy" decoding="async" />
              )}
            </div>
          ) : (
            <div className="portfolio-secondary-glyph" aria-hidden>
              <span className="portfolio-glyph-tile">{item.glyph ?? '◇'}</span>
              <span className="portfolio-glyph-cat">{item.category}</span>
            </div>
          )}
          <div className="portfolio-secondary-body">
            <span className="section-label">{item.category}</span>
            <h3 className="portfolio-secondary-title">{item.title}</h3>
            <p className="portfolio-secondary-desc">{item.description}</p>
            <div className="portfolio-tags">
              {item.tags.map((t) => (
                <span key={t} className="portfolio-tag">{t}</span>
              ))}
            </div>
            <div className="portfolio-links">
              <ProjectLink item={item} />
              {item.secondaryLink && (
                <a
                  href={item.secondaryLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="portfolio-link portfolio-link--secondary"
                >
                  {item.secondaryLabel}
                </a>
              )}
            </div>
          </div>
        </motion.article>
        );
      })}
    </div>
  </section>
  </div>
  );
};

export default Portfolio;
