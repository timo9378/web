import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import InfoPage from './InfoPage';
import { LinkCard } from '@/components/common/LinkCard';
import { lookupOr } from '@/lib/tableLookup';

const SITE_BIRTH = new Date('2025-04-01T00:00:00+08:00');

// date 與 big 穩定；text 隨語系
const MILESTONE_META = [
  { date: '2025-04-01', big: true }, { date: '2025-04-05' }, { date: '2025-08-25', big: true }, { date: '2025-09-24' },
  { date: '2025-10-07' }, { date: '2025-10-09' }, { date: '2025-10-10' }, { date: '2025-10-14', big: true },
  { date: '2026-01-08' }, { date: '2026-02-19' }, { date: '2026-02-21' },
  { date: '2026-04-20', big: true }, { date: '2026-04-26', big: true }, { date: '2026-05-15', big: true },
  { date: '2026-05-25', big: true }, { date: '2026-05-28', big: true }, { date: '2026-06-24', big: true },
  { date: '2026-06-26', big: true }, { date: '2026-07-14', big: true }, { date: '2026-07-19', big: true },
  { date: '2026-07-21', big: true },
];

const MILESTONE_TEXTS = {
  'zh-TW': [
    '站點誕生',
    'Hero 與作品集上線',
    '部落格上線',
    '效能優化大改造',
    'Activity 動態頁面',
    '0G Library 3D 書櫃',
    '星空相簿與 Music',
    '自訂網域',
    '搬家到自家 HomeLab',
    '玻璃擬態風格導入',
    'OAuth 登入與權限分級',
    '多語系 i18n 導入',
    '大規模設計重做',
    '首頁重做與 Newsletter',
    '資訊頁與視覺重整',
    '全站 i18n 落地 5 語系',
    '全站 JS → TS 遷移',
    '前端遷到 TanStack Start',
    '後端 Express → Rust',
    'WebGPU 太空背景轉正',
    'MDX 內容管線',
  ],
  'zh-CN': [
    '站点诞生',
    'Hero 与作品集上线',
    '部落格上线',
    '效能优化大改造',
    'Activity 动态页面',
    '0G Library 3D 书柜',
    '星空相簿与 Music',
    '自定义网域',
    '搬家到自家 HomeLab',
    '玻璃拟态风格导入',
    'OAuth 登入与权限分级',
    '多语系 i18n 导入',
    '大规模设计重做',
    '首页重做与 Newsletter',
    '信息页与视觉重整',
    '全站 i18n 落地 5 语系',
    '全站 JS → TS 迁移',
    '前端迁到 TanStack Start',
    '后端 Express → Rust',
    'WebGPU 太空背景转正',
    'MDX 内容管线',
  ],
  en: [
    'Site born',
    'Hero and Portfolio live',
    'Blog launched',
    'Performance overhaul',
    'Activity dashboard',
    '0G Library 3D bookshelf',
    'Starry album and Music',
    'Custom domain',
    'Moved to my own HomeLab',
    'Glassmorphism rolled out',
    'OAuth login and RBAC',
    'Multi-locale i18n',
    'Major design redo',
    'Home page redo and Newsletter',
    'Info pages and visual refresh',
    'Site-wide i18n in 5 locales',
    'Whole codebase JS → TS',
    'Frontend moved to TanStack Start',
    'Backend Express → Rust',
    'WebGPU starfield by default',
    'MDX content pipeline',
  ],
  ja: [
    'サイト誕生',
    'Hero とポートフォリオ公開',
    'ブログ公開',
    'パフォーマンス大改造',
    'Activity ダッシュボード',
    '0G Library 3D 本棚',
    '星空アルバムと Music',
    '独自ドメインへ',
    '自宅 HomeLab に引越し',
    'ガラスモーフィズム導入',
    'OAuth ログインと RBAC',
    '多言語 i18n 導入',
    '大規模デザイン刷新',
    'ホームページ刷新と Newsletter',
    '情報ページと視覚刷新',
    'サイト全体 i18n 5 言語',
    'サイト全体 JS → TS 移行',
    'フロントエンドを TanStack Start へ',
    'バックエンド Express → Rust',
    'WebGPU 星空を既定に',
    'MDX コンテンツパイプライン',
  ],
  ko: [
    '사이트 탄생',
    'Hero와 포트폴리오 공개',
    '블로그 오픈',
    '성능 대대적 개선',
    'Activity 대시보드',
    '0G Library 3D 책장',
    '별 사진첩과 Music',
    '커스텀 도메인',
    '자체 HomeLab으로 이사',
    '글래스모피즘 도입',
    'OAuth 로그인과 RBAC',
    '다국어 i18n 도입',
    '대규모 디자인 재작업',
    '홈 페이지 재작업과 Newsletter',
    '정보 페이지와 비주얼 정비',
    '사이트 전체 i18n 5개 로케일',
    '사이트 전체 JS → TS 전환',
    '프런트엔드를 TanStack Start로',
    '백엔드 Express → Rust',
    'WebGPU 별하늘 기본값',
    'MDX 콘텐츠 파이프라인',
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
    const units = lookupOr(UPTIME_UNITS, lang, UPTIME_UNITS['zh-TW']);
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
  const extras = lookupOr(HISTORY_EXTRAS, lang, HISTORY_EXTRAS['zh-TW']);
  const uptimeUnits = lookupOr(UPTIME_UNITS, lang, UPTIME_UNITS['zh-TW']);
  const texts = lookupOr(MILESTONE_TEXTS, lang, MILESTONE_TEXTS['zh-TW']);
  // ⚠ 同一天可以有兩個里程碑（2026-04-26 一度就是這樣，該筆已下架），所以 key 不能只用 date——
  //   React 會因為 key 重複而無法區分那兩項，重繪時可能重用到錯的節點。
  //   MILESTONE_META 是靜態陣列、順序固定，所以在這裡一次配好 id 就是穩定的。
  const milestones = MILESTONE_META.map((m, i) => ({ ...m, text: texts[i], key: `${m.date}-${i}` }));

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
            key={m.key}
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
