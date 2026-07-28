import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InfoPage from './InfoPage';
import { LinkCard } from './LinkCard';
import { pickByLang } from '../lib/pickByLang';

const SITE_BIRTH = new Date('2025-04-01T00:00:00+08:00');

// date 與 big 穩定；text 隨語系
const MILESTONE_META = [
  { date: '2025-04-01', big: true }, { date: '2025-04-05' }, { date: '2025-08-25', big: true }, { date: '2025-09-24' }, { date: '2025-10-07' },
  { date: '2025-10-08' }, { date: '2025-10-09' }, { date: '2025-10-10' }, { date: '2025-10-11' }, { date: '2025-10-14', big: true },
  { date: '2025-12-10' }, { date: '2026-01-08' }, { date: '2026-02-11' }, { date: '2026-02-19' }, { date: '2026-02-20' },
  { date: '2026-02-21' }, { date: '2026-02-24' }, { date: '2026-02-26' }, { date: '2026-04-09' }, { date: '2026-04-18' },
  { date: '2026-04-20', big: true }, { date: '2026-04-25' }, { date: '2026-04-26', big: true }, { date: '2026-04-26' }, { date: '2026-05-08' },
  { date: '2026-05-15', big: true }, { date: '2026-05-25', big: true },
  { date: '2026-05-28', big: true },
  { date: '2026-06-24', big: true },
];

const MILESTONE_TEXTS = {
  'zh-TW': [
    '站點誕生 — Docker + SSL + Nginx 反向代理一次配齊',
    'Hero 區與作品集首版上線',
    '部落格上線 — 前後端完整實作（Express + SQLite + Nginx）。文章跟書籍忘記備份要找一下在哪裡...',
    '效能優化大改造 — Lazy loading / useInView / 不可見時暫停動畫',
    'Activity 動態頁面 + Steam / GitHub API 整合',
    'Now 頁面 — 「目前在做什麼」（mood / location / learning / projects）',
    '0G Library — Three.js 3D 書本互動',
    'PhotoViewer 全螢幕 + 星空相簿 + Music (Spotify)',
    'shadcn/ui 元件導入 + 後台 Dashboard 重構',
    '自訂網域 — koimsurai.blogsyte.com:13579 → koimsurai.com',
    '全專案改用 pnpm，新增 /cinema /anime 頁面',
    '搬家到自家 HomeLab — Ubuntu 重灌、Docker 起跑、站台從舊機器整批遷移過來',
    'SEOHead 動態 metadata + Setup 深空主題頁面',
    '玻璃擬態風格全面導入 + AI 文章生成功能',
    'AI 摘要 + AI 標籤建議 + ImageLightbox 燈箱',
    'OAuth 登入 + RBAC 用戶管理（管理員 / 訪客分權）',
    'RSS 供應 + Mermaid 圖表語法支援',
    '404 頁面 + 自動 OG 圖生成 + CJK 字型安裝',
    '黑洞、動態頁面重構 + 動態 sitemap',
    'Spotify audio-features API 棄用緊急應對 — 加快取 + 熔斷器',
    '多語系 i18n — zh-TW / zh-CN / en / ja + OpenCC 繁簡轉換 + Monaco per-locale models',
    'Blog 風格統一 + Zen 編輯模式 + 拖放上傳 + 斜線指令 + View Transitions',
    '大規模設計重做 — Shiki + PWA + Series + Reactions + koim 全域按鈕系統 + Steam 動畫頭像',
    '處理 33 個 Dependabot 漏洞（vite / axios / xmldom / dompurify / lodash / serialize-javascript ...）',
    'Thumbhash 模糊佔位圖 + 編輯器 Vim 模式 + 自訂 snippets + 閱讀時間',
    '首頁版面重做 + 蟲洞 intro + Newsletter 全套訂閱系統（Resend）',
    '新增 此站點 / 歷史 / 留言 三頁 + Portfolio 補上 GitHub repos + 全站字型統一 MiSans + Hero / Footer / Mega menu 視覺重整',
    '全站 i18n 落地 — 5 語系 + 瀏覽器語言自動偵測 + 個人內容全數翻譯 + 字型 :lang() 切換',
    '全站 JS → TS 遷移完成 — 162 檔轉 TypeScript strict、tsc / eslint 全 0 error',
  ],
  'zh-CN': [
    '站点诞生 — Docker + SSL + Nginx 反向代理一次配齐',
    'Hero 区与作品集首版上线',
    '部落格上线 — 前后端完整实作（Express + SQLite + Nginx）。文章跟书籍忘记备份要找一下在哪里...',
    '效能优化大改造 — Lazy loading / useInView / 不可见时暂停动画',
    'Activity 动态页面 + Steam / GitHub API 整合',
    'Now 页面 — 「目前在做什么」（mood / location / learning / projects）',
    '0G Library — Three.js 3D 书本互动',
    'PhotoViewer 全屏 + 星空相簿 + Music (Spotify)',
    'shadcn/ui 元件导入 + 后台 Dashboard 重构',
    '自定义网域 — koimsurai.blogsyte.com:13579 → koimsurai.com',
    '全项目改用 pnpm，新增 /cinema /anime 页面',
    '搬家到自家 HomeLab — Ubuntu 重装、Docker 起跑、站点从旧机器整批迁移过来',
    'SEOHead 动态 metadata + Setup 深空主题页面',
    '玻璃拟态风格全面导入 + AI 文章生成功能',
    'AI 摘要 + AI 标签建议 + ImageLightbox 灯箱',
    'OAuth 登入 + RBAC 用户管理（管理员 / 访客分权）',
    'RSS 供应 + Mermaid 图表语法支援',
    '404 页面 + 自动 OG 图生成 + CJK 字型安装',
    '黑洞、动态页面重构 + 动态 sitemap',
    'Spotify audio-features API 弃用紧急应对 — 加快取 + 熔断器',
    '多语系 i18n — zh-TW / zh-CN / en / ja + OpenCC 繁简转换 + Monaco per-locale models',
    'Blog 风格统一 + Zen 编辑模式 + 拖放上传 + 斜线指令 + View Transitions',
    '大规模设计重做 — Shiki + PWA + Series + Reactions + koim 全域按钮系统 + Steam 动画头像',
    '处理 33 个 Dependabot 漏洞（vite / axios / xmldom / dompurify / lodash / serialize-javascript ...）',
    'Thumbhash 模糊占位图 + 编辑器 Vim 模式 + 自定义 snippets + 阅读时间',
    '首页版面重做 + 虫洞 intro + Newsletter 全套订阅系统（Resend）',
    '新增 此站点 / 历史 / 留言 三页 + Portfolio 补上 GitHub repos + 全站字型统一 MiSans + Hero / Footer / Mega menu 视觉重整',
    '全站 i18n 落地 — 5 语系 + 浏览器语言自动侦测 + 个人内容全数翻译 + 字型 :lang() 切换',
    '全站 JS → TS 迁移完成 — 162 档转 TypeScript strict、tsc / eslint 全 0 error',
  ],
  en: [
    'Site born — Docker + SSL + Nginx reverse proxy all set in one shot',
    'Hero and Portfolio v1 live',
    'Blog launched — full stack (Express + SQLite + Nginx). Forgot to back up posts and books, now I need to dig around for where they are...',
    'Performance overhaul — lazy loading / useInView / pause animation off-screen',
    'Activity dashboard + Steam / GitHub API integration',
    'Now page — "what I\'m up to right now" (mood / location / learning / projects)',
    '0G Library — Three.js 3D interactive bookshelf',
    'PhotoViewer fullscreen + starry album + Music (Spotify)',
    'shadcn/ui adopted + admin dashboard refactor',
    'Custom domain — koimsurai.blogsyte.com:13579 → koimsurai.com',
    'Migrated entire project to pnpm; added /cinema and /anime pages',
    'Moved to my own HomeLab — Ubuntu reinstall, Docker spin-up, full site migration from the old box',
    'SEOHead dynamic metadata + Setup deep-space themed page',
    'Glassmorphism rolled out site-wide + AI post generation',
    'AI summaries + AI tag suggestions + ImageLightbox',
    'OAuth login + RBAC (admin / visitor split)',
    'RSS feed + Mermaid diagram syntax support',
    '404 page + auto OG image generation + CJK font install',
    'Black hole, Activity refactor + dynamic sitemap',
    'Emergency fix for Spotify audio-features deprecation — cache + circuit breaker',
    'Multi-locale i18n — zh-TW / zh-CN / en / ja + OpenCC conversion + Monaco per-locale models',
    'Blog style unified + Zen editor mode + drag-drop upload + slash commands + View Transitions',
    'Major design redo — Shiki + PWA + Series + Reactions + koim global button system + Steam animated avatar',
    'Cleared 33 Dependabot alerts (vite / axios / xmldom / dompurify / lodash / serialize-javascript ...)',
    'Thumbhash blur placeholders + Vim mode in editor + custom snippets + reading time',
    'Home page redo + wormhole intro + full Newsletter subscription stack (Resend)',
    'Added About-site / History / Messages pages + Portfolio GitHub repos + site-wide MiSans font + Hero / Footer / Mega menu visual refresh',
    'Site-wide i18n landed — 5 locales + browser auto-detect + every personal section translated + per-locale font swap via :lang()',
    'Whole codebase JS → TS migration done — 162 files to strict TypeScript, 0 tsc / eslint errors',
  ],
  ja: [
    'サイト誕生 — Docker + SSL + Nginx リバプロを一気に整備',
    'Hero とポートフォリオの初版を公開',
    'ブログ公開 — フロントエンド・バックエンドを完成（Express + SQLite + Nginx）。記事と本のバックアップを忘れて、保存場所を探さないと...',
    'パフォーマンス大改造 — Lazy loading / useInView / 非表示時のアニメーション停止',
    'Activity ダッシュボード + Steam / GitHub API を統合',
    'Now ページ — 「今やってること」(mood / location / learning / projects)',
    '0G Library — Three.js による 3D 本のインタラクション',
    'PhotoViewer フルスクリーン + 星空アルバム + Music (Spotify)',
    'shadcn/ui を導入 + 管理ダッシュボード刷新',
    '独自ドメインへ — koimsurai.blogsyte.com:13579 → koimsurai.com',
    'プロジェクト全体を pnpm 化、/cinema /anime ページを追加',
    '自宅 HomeLab に引越し — Ubuntu 再インストール、Docker 立ち上げ、サイトを旧マシンからまるごと移行',
    'SEOHead 動的メタデータ + Setup 深宇宙テーマページ',
    'ガラスモーフィズムを全面導入 + AI 記事生成機能',
    'AI 要約 + AI タグ提案 + ImageLightbox ライトボックス',
    'OAuth ログイン + RBAC ユーザー管理（管理者 / 訪問者の権限分け）',
    'RSS 配信 + Mermaid ダイアグラム構文サポート',
    '404 ページ + OG 画像自動生成 + CJK フォント導入',
    'ブラックホール、Activity 再設計 + 動的 sitemap',
    'Spotify audio-features API 廃止への緊急対応 — キャッシュ + サーキットブレーカー',
    '多言語 i18n — zh-TW / zh-CN / en / ja + OpenCC 繁簡変換 + Monaco の言語別モデル',
    'ブログのスタイル統一 + Zen 編集モード + ドラッグ&ドロップアップロード + スラッシュコマンド + View Transitions',
    '大規模デザイン刷新 — Shiki + PWA + Series + Reactions + koim グローバルボタン + Steam アニメーションアバター',
    'Dependabot のアラート 33 件を処理（vite / axios / xmldom / dompurify / lodash / serialize-javascript ...）',
    'Thumbhash のぼかしプレースホルダー + エディタの Vim モード + カスタム snippets + 読了時間',
    'ホームページ刷新 + ワームホール intro + Newsletter 購読システム一式（Resend）',
    'このサイト / 歴史 / メッセージの 3 ページを追加 + Portfolio に GitHub repos 追加 + 全サイトフォントを MiSans に統一 + Hero / Footer / Mega menu の視覚刷新',
    'サイト全体に i18n を導入 — 5 言語対応 + ブラウザ言語の自動判定 + 個人セクションすべて翻訳 + :lang() による言語別フォント切替',
    'サイト全体を JS → TS へ移行完了 — 162 ファイルを strict TypeScript 化、tsc / eslint エラー 0',
  ],
  ko: [
    '사이트 탄생 — Docker + SSL + Nginx 리버스 프록시를 한 번에 정비',
    'Hero와 포트폴리오 첫 버전을 공개',
    '블로그 오픈 — 프런트엔드와 백엔드 완성(Express + SQLite + Nginx). 글과 책을 백업하는 걸 깜빡해서 어디 있는지 찾아봐야 합니다...',
    '성능 대대적 개선 — 레이지 로딩 / useInView / 비활성 시 애니메이션 일시 정지',
    'Activity 대시보드 + Steam / GitHub API 통합',
    'Now 페이지 — 「지금 뭐 하고 있어요」(mood / location / learning / projects)',
    '0G Library — Three.js로 만든 3D 책 인터랙션',
    'PhotoViewer 전체화면 + 별 사진첩 + Music(Spotify)',
    'shadcn/ui 도입 + 관리자 대시보드 리팩터링',
    '커스텀 도메인 — koimsurai.blogsyte.com:13579 → koimsurai.com',
    '프로젝트 전체를 pnpm으로 전환, /cinema /anime 페이지 추가',
    '자체 HomeLab으로 이사 — Ubuntu 재설치, Docker 가동, 사이트를 옛 머신에서 통째로 이전',
    'SEOHead 동적 메타데이터 + Setup 딥 스페이스 테마 페이지',
    '글래스모피즘 전면 도입 + AI 글 생성 기능',
    'AI 요약 + AI 태그 추천 + ImageLightbox 라이트박스',
    'OAuth 로그인 + RBAC 사용자 관리(관리자 / 방문자 권한 분리)',
    'RSS 제공 + Mermaid 다이어그램 문법 지원',
    '404 페이지 + OG 이미지 자동 생성 + CJK 폰트 설치',
    '블랙홀, Activity 페이지 리팩터링 + 동적 sitemap',
    'Spotify audio-features API 폐기 대응 — 캐시 + 서킷 브레이커',
    '다국어 i18n — zh-TW / zh-CN / en / ja + OpenCC 번체/간체 변환 + Monaco 언어별 모델',
    '블로그 스타일 통일 + 젠 모드 + 드래그&드롭 업로드 + 슬래시 커맨드 + View Transitions',
    '대규모 디자인 재작업 — Shiki + PWA + Series + Reactions + koim 전역 버튼 시스템 + Steam 애니메이션 아바타',
    'Dependabot 알림 33건 처리(vite / axios / xmldom / dompurify / lodash / serialize-javascript ...)',
    'Thumbhash 블러 플레이스홀더 + 에디터 Vim 모드 + 커스텀 스니펫 + 읽기 시간',
    '홈 페이지 재작업 + 웜홀 인트로 + Newsletter 구독 시스템 일체(Resend)',
    '이 사이트 / 역사 / 메시지 세 페이지 추가 + Portfolio에 GitHub 레포 추가 + 사이트 전체 폰트를 MiSans로 통일 + Hero / Footer / Mega menu 비주얼 정비',
    '사이트 전반에 i18n 도입 — 5 개 로케일 + 브라우저 언어 자동 감지 + 개인 섹션 전체 번역 + :lang() 기반 폰트 전환',
    '사이트 전체 JS → TS 마이그레이션 완료 — 162개 파일 strict TypeScript 전환, tsc / eslint 에러 0',
  ],
};

const UPTIME_UNITS = {
  'zh-TW': { d: '天', h: '小時', m: '分', s: '秒', label: '本站已運行：' },
  'zh-CN': { d: '天', h: '小时', m: '分', s: '秒', label: '本站已运行：' },
  en: { d: 'd', h: 'h', m: 'm', s: 's', label: 'Site has been running for: ' },
  ja: { d: '日', h: '時間', m: '分', s: '秒', label: 'サイト稼働時間：' },
  ko: { d: '일', h: '시간', m: '분', s: '초', label: '사이트 가동 시간: ' },
};

const HISTORY_EXTRAS = {
  'zh-TW': {
    intro: '從 2025 年 4 月第一個 commit 到現在，記錄站點走過的每一個重要轉折。以下只挑出比較重要的時間點，碎碎念的變更就不列了。',
    heading: '里程碑',
    thanks: '一路走來，感謝有你。',
    moreSides: '想看更多側面，或是找我聊天，可以從這裡開始：',
  },
  'zh-CN': {
    intro: '从 2025 年 4 月第一个 commit 到现在，记录站点走过的每一个重要转折。以下只挑出比较重要的时间点，碎碎念的变更就不列了。',
    heading: '里程碑',
    thanks: '一路走来，感谢有你。',
    moreSides: '想看更多侧面，或是找我聊天，可以从这里开始：',
  },
  en: {
    intro: 'From the first commit in April 2025 to now — a log of every meaningful turn this site has taken. Only the bigger moments are listed; the small tweaks are skipped.',
    heading: 'Milestones',
    thanks: 'Thank you for being here along the way.',
    moreSides: 'Want to see more, or just say hi? Start here:',
  },
  ja: {
    intro: '2025 年 4 月の最初の commit から今まで、サイトの重要な節目を記録しています。細かい変更は省いて、大きな出来事だけ残しました。',
    heading: 'マイルストーン',
    thanks: 'ここまで一緒に来てくれて、ありがとう。',
    moreSides: 'もっと知りたい、あるいは雑談したいなら、ここから：',
  },
  ko: {
    intro: '2025 년 4 월 첫 커밋부터 지금까지, 사이트가 거쳐 온 중요한 변곡점을 기록했습니다. 자잘한 변경은 빼고 굵직한 사건만 모았어요.',
    heading: '마일스톤',
    thanks: '여기까지 함께해 줘서 고마워요.',
    moreSides: '더 보고 싶거나 이야기 나누고 싶다면, 여기서 시작하세요:',
  },
};

function useUptime(lang: string) {
  const [text, setText] = useState('');
  useEffect(() => {
    const units = pickByLang(UPTIME_UNITS, lang, UPTIME_UNITS['zh-TW']);
    const fmt = () => {
      const now = new Date();
      const diffMs = now.getTime() - SITE_BIRTH.getTime();
      const days = Math.floor(diffMs / 86400000);
      const hours = Math.floor((diffMs % 86400000) / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      // 同 Watch 的 liveProgress：每秒跳動的計時器改 useSyncExternalStore 會無限重繪
      // （getSnapshot 含 Date.now() → 每次 render 都是新值）。維持 setInterval + setState。
      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setText(`${days} ${units.d} ${hours} ${units.h} ${mins} ${units.m} ${secs} ${units.s}`);
    };
    fmt();
    const t = setInterval(fmt, 1000);
    return () => clearInterval(t);
  }, [lang]);
  return text;
}

function History() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const uptime = useUptime(lang);
  const extras = pickByLang(HISTORY_EXTRAS, lang, HISTORY_EXTRAS['zh-TW']);
  const uptimeUnits = pickByLang(UPTIME_UNITS, lang, UPTIME_UNITS['zh-TW']);
  const texts = pickByLang(MILESTONE_TEXTS, lang, MILESTONE_TEXTS['zh-TW']);
  const milestones = MILESTONE_META.map((m, i) => ({ ...m, text: texts[i] }));

  return (
    <InfoPage
      title={t('info.history.title')}
      subtitle={t('info.history.subtitle')}
      slug="history"
      prev={{ to: '/about-site', title: `${t('info.aboutSite.title')} — ${t('info.aboutSite.subtitle')}` }}
      next={{ to: '/messages', title: `${t('info.messages.title')} — ${t('info.messages.subtitle')}` }}
      closingNote={`${uptimeUnits.label}${uptime}`}
    >
      <p>{extras.intro}</p>

      <h2 id="timeline">{extras.heading}</h2>

      <ul className="info-page-timeline">
        {milestones.map((m) => (
          <li
            key={m.date}
            className={'info-page-timeline-item' + (m.big ? ' info-page-timeline-item--big' : '')}
          >
            <span className="info-page-timeline-date">{m.date}</span>
            <span className="info-page-timeline-text">
              {m.big ? <strong>{m.text}</strong> : m.text}
            </span>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: '2rem', fontWeight: 600, color: 'rgba(244,244,245,0.95)' }}>
        {extras.thanks}
      </p>

      <p style={{ marginTop: '2.5rem', color: 'rgba(229,229,245,0.55)', fontSize: '0.9rem' }}>
        {extras.moreSides}
      </p>
      <LinkCard href="https://github.com/timo9378" />
    </InfoPage>
  );
}

export default History;
