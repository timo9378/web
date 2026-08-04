interface QuickFact { label: string; value: string }

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import './AboutMe.css';
import { lookupOr } from '@/lib/tableLookup';

// Quick Facts label 是英文(不翻),value 隨語系變
const QUICK_FACTS_BY_LANG: Record<string, QuickFact[]> = {
  'zh-TW': [
    { label: 'Born', value: '2004 · 雲林' },
    { label: 'School', value: 'NTUST · 資管系 4 年級' },
    { label: 'Currently', value: '微星科技 軟體工程實習' },
    { label: 'Side', value: '攝影 · 旅遊 · 閱讀' },
    { label: 'Coding since', value: '2017' },
  ],
  'zh-CN': [
    { label: 'Born', value: '2004 · 云林' },
    { label: 'School', value: 'NTUST · 资管系 4 年级' },
    { label: 'Currently', value: '微星科技 软体工程实习' },
    { label: 'Side', value: '摄影 · 旅游 · 阅读' },
    { label: 'Coding since', value: '2017' },
  ],
  en: [
    { label: 'Born', value: '2004 · Yunlin, Taiwan' },
    { label: 'School', value: 'NTUST · IM, 4th year' },
    { label: 'Currently', value: 'Software Engineer Intern @ MSI' },
    { label: 'Side', value: 'Photography · Travel · Reading' },
    { label: 'Coding since', value: '2017' },
  ],
  ja: [
    { label: 'Born', value: '2004 · 雲林（台湾）' },
    { label: 'School', value: 'NTUST · 情報管理学科 4 年' },
    { label: 'Currently', value: 'MSI ソフトウェアエンジニア インターン' },
    { label: 'Side', value: '写真・旅・読書' },
    { label: 'Coding since', value: '2017' },
  ],
  ko: [
    { label: 'Born', value: '2004 · 윈린(대만)' },
    { label: 'School', value: 'NTUST · 정보관리학과 4학년' },
    { label: 'Currently', value: 'MSI 소프트웨어 엔지니어 인턴' },
    { label: 'Side', value: '사진 · 여행 · 독서' },
    { label: 'Coding since', value: '2017' },
  ],
};

const PARAGRAPHS_BY_LANG: Record<string, string[]> = {
  'zh-TW': [
    '我是 Koimsurai，2004 年出生的雲林人。目前就讀國立台灣科技大學資訊管理系四年級，現於微星科技 (MSI) 擔任軟體工程實習生，並於部門內實質負責前端框架標準與底層架構設計。',
    '過去具備 C++ / Python / Golang 與 App 開發經驗。在微星任職期間，我主導導入 Tauri + Rust 現代化輕量架構，替換原有龐大系統；獨立建置跨環境的 CI/CD 自動化部署管線，並完成「雲地混合 (Cloud-Edge Hybrid)」的 AI 系統部署架構。具備從前端 UI/UX 到系統底層記憶體控管的全端落地能力，並能解決複雜的跨環境編譯與資安漏洞問題。',
    '工作之外，我是一名 HomeLab 狂熱者。自行維護 24/7 的伺服器叢集，並從零開發個人 Web NAS OS (Next.js + Rust) 與專屬 AI 助理。',
    '我曾擔任資管系學會會長與程式講師，習慣用 Notion 與 GitHub 梳理複雜資訊，並熟練使用 Figma 進行介面設計。我相信好的軟體不僅需要強悍的底層架構支撐，更要在不同類型的產品與使用者之間，做出讓人覺得「順手」的東西。期許未來能持續在系統架構與 AI 整合領域發揮影響力。',
  ],
  'zh-CN': [
    '我是 Koimsurai，2004 年出生于云林。目前就读国立台湾科技大学资讯管理系四年级，于微星科技 (MSI) 担任软体工程实习生，并于部门内实质负责前端框架标准与底层架构设计。',
    '过去具备 C++ / Python / Golang 与 App 开发经验。在微星任职期间，我主导导入 Tauri + Rust 现代化轻量架构，替换原有庞大系统；独立建置跨环境的 CI/CD 自动化部署管线，并完成「云地混合 (Cloud-Edge Hybrid)」的 AI 系统部署架构。具备从前端 UI/UX 到系统底层记忆体控管的全端落地能力，并能解决复杂的跨环境编译与资安漏洞问题。',
    '工作之外，我是一名 HomeLab 狂热者。自行维护 24/7 的伺服器丛集，并从零开发个人 Web NAS OS (Next.js + Rust) 与专属 AI 助理。',
    '我曾担任资管系学会会长与程式讲师，习惯用 Notion 与 GitHub 梳理复杂资讯，并熟练使用 Figma 进行介面设计。我相信好的软体不仅需要强悍的底层架构支撑，更要在不同类型的产品与使用者之间，做出让人觉得「顺手」的东西。期许未来能持续在系统架构与 AI 整合领域发挥影响力。',
  ],
  en: [
    "I'm Koimsurai, born in 2004 in Yunlin, Taiwan. Currently a 4th-year IM student at National Taiwan University of Science and Technology (NTUST), interning as a software engineer at MSI — where I'm effectively responsible for frontend framework standards and underlying architecture design within my team.",
    "I have prior experience with C++, Python, Golang and app development. At MSI I led the adoption of a modern lightweight Tauri + Rust architecture to replace bulky legacy systems; built cross-environment CI/CD pipelines from scratch; and shipped an AI deployment architecture for cloud–edge hybrid workloads. My stack spans frontend UI/UX down to low-level memory management, plus debugging cross-platform builds and security issues.",
    "Outside work I'm a HomeLab enthusiast — maintaining a 24/7 server cluster and building a personal Web NAS OS (Next.js + Rust) and my own AI assistant from scratch.",
    "I served as president of NTUST's IM student council and as a programming instructor. I rely on Notion and GitHub to organize complex info, and Figma for UI design. I believe great software needs both solid foundations and an effortless feel across products and users. Hoping to keep making impact in system architecture and AI integration.",
  ],
  ja: [
    '私は Koimsurai、2004 年に台湾雲林県生まれ。国立台湾科技大学（NTUST）情報管理学科 4 年に在学中、MSI（微星科技）でソフトウェアエンジニアのインターンとして、部門内のフロントエンドフレームワーク標準と基盤アーキテクチャ設計を実質的に担当しています。',
    'C++ / Python / Golang・アプリ開発の経験を持ち、MSI では Tauri + Rust のモダンで軽量なアーキテクチャを主導導入し、既存の大規模システムを置き換えました。クロス環境の CI/CD 自動化パイプラインを単独で構築し、「クラウド・エッジハイブリッド」型 AI システムのデプロイアーキテクチャも完成させました。フロントエンド UI/UX からシステム下層のメモリ管理まで対応でき、クロス環境ビルドやセキュリティの問題も解決できます。',
    '仕事以外では HomeLab 愛好家。24/7 稼働のサーバークラスタを自前で運用し、Web NAS OS (Next.js + Rust) と専属 AI アシスタントをゼロから開発しています。',
    'NTUST 情報管理学科の学生会長と、プログラミング講師の経験があります。Notion と GitHub で複雑な情報を整理し、Figma で UI 設計するのが得意です。良いソフトウェアには強固な基盤と、製品や利用者を超えて「使いやすい」と感じてもらえる仕上がりの両方が必要だと考えています。今後もシステムアーキテクチャと AI 統合の分野で影響を残せたら、と思っています。',
  ],
  ko: [
    '저는 Koimsurai, 2004년 대만 윈린에서 태어났습니다. 현재 국립대만과학기술대학교(NTUST) 정보관리학과 4학년에 재학 중이며, MSI(미신과학기)에서 소프트웨어 엔지니어 인턴으로 일하면서 부서 내 프런트엔드 프레임워크 표준과 기반 아키텍처 설계를 실질적으로 담당하고 있습니다.',
    'C++ / Python / Golang과 앱 개발 경험이 있습니다. MSI 재직 중에는 Tauri + Rust 기반의 현대적이고 가벼운 아키텍처 도입을 주도해 기존의 거대한 시스템을 교체했고, 크로스 환경 CI/CD 자동화 파이프라인을 단독으로 구축했으며, 「클라우드–엣지 하이브리드」 형태의 AI 시스템 배포 아키텍처를 완성했습니다. 프런트엔드 UI/UX부터 시스템 저수준 메모리 관리까지 두루 다루며, 복잡한 크로스 환경 빌드와 보안 이슈도 해결할 수 있어요.',
    '업무 외에는 HomeLab 마니아입니다. 24/7 가동하는 서버 클러스터를 직접 운영하고, Web NAS OS(Next.js + Rust)와 개인 AI 어시스턴트를 처음부터 개발하고 있어요.',
    'NTUST 정보관리학과 학생회장과 프로그래밍 강사를 맡은 적이 있습니다. Notion과 GitHub으로 복잡한 정보를 정리하고, Figma로 UI를 디자인합니다. 좋은 소프트웨어는 견고한 기반과, 제품과 사용자 사이에서 「자연스럽게」 느껴지는 마무리가 함께 있어야 한다고 믿습니다. 앞으로도 시스템 아키텍처와 AI 통합 분야에서 영향력을 남기고 싶어요.',
  ],
};

const AboutMe = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const QUICK_FACTS = lookupOr(QUICK_FACTS_BY_LANG, lang, QUICK_FACTS_BY_LANG['zh-TW']);
  const PARAGRAPHS = lookupOr(PARAGRAPHS_BY_LANG, lang, PARAGRAPHS_BY_LANG['zh-TW']);
  return (
  <section id="about-me" className="home-section about-me-v2">
    <div className="home-section-eyebrow">
      <span className="section-label">About</span>
      <span className="section-eyebrow-count">{t('home.aboutMe.eyebrow')}</span>
    </div>

    <div className="about-grid">
      <motion.div
        className="about-bio"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <h2 className="section-hero-title">{t('home.aboutMe.titleLine1')}<br />{t('home.aboutMe.titleLine2')}</h2>
        {PARAGRAPHS.map((p) => (
          <p key={p} className="about-paragraph">{p}</p>
        ))}
      </motion.div>

      <motion.aside
        className="about-facts glass-card"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
      >
        <span className="section-label about-facts-label">Quick Facts</span>
        <dl>
          {QUICK_FACTS.map((f) => (
            <div key={f.label} className="about-fact-row">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </motion.aside>
    </div>
  </section>
  );
};

export default AboutMe;