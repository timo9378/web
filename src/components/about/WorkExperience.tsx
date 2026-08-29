interface ExpGroup {
  heading: string;
  items: string[];
}
interface Experience {
  title: string;
  role: string;
  groups?: ExpGroup[];
  bullets?: string[];
}

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import './WorkExperience.css';
import { lookupOr } from '@/lib/tableLookup';

// 期間 + tags 穩定（技術名英文）, 其餘隨語系
const PERIODS = ['2025/7 — Now', '2024/9 — Now', '2024/10 — 2025/6'];
const TAGS = [
  ['Monorepo', 'Turborepo', 'TypeScript', 'ASP.NET', 'Python', 'GitLab CI/CD'],
  ['Python', 'Scratch', 'MCE', 'App Inventor'],
  ['Kotlin', 'Android', 'Premiere Pro'],
];

const EXPERIENCES_BY_LANG: Record<string, Experience[]> = {
  'zh-TW': [
    {
      title: '微星科技股份有限公司',
      role: '軟體工程師',
      groups: [
        {
          heading: '前端架構與標準化',
          items: [
            '主導導入 Monorepo 架構：用 Turborepo 整合內部多個前端專案，解決跨專案代碼共用與版控痛點',
            '建立 ESLint / Prettier / TypeScript 嚴格規則，提升團隊代碼品質',
            '封裝共用 UI Library 與 Utility Libraries，提供其他團隊（如 IT Team）復用',
            '撰寫標準化開發文件與 README，協助團隊成員上手新架構',
          ],
        },
        {
          heading: '後端開發與維護',
          items: [
            '維護 ASP.NET (C#) 與 Legacy Web API，解決 .NET Framework 相容性與 .web.config 配置問題',
            '處理 MS SQL 資料庫權限控管與 Stored Procedure 邏輯除錯',
            '用 Python 撰寫網頁爬蟲與自動化腳本，協助資料收集與批次處理',
          ],
        },
        {
          heading: 'DevOps 與流程優化',
          items: [
            '參與 GitLab CI/CD Pipeline 建置與維護，確保 Monorepo 自動化建置部署流暢',
            '熟悉 Git Flow，協助團隊解決版本衝突與 Merge Request Code Review',
          ],
        },
        {
          heading: '跨部門協作',
          items: [
            '與 AI Team / IT Team 緊密合作，作為前端技術窗口整合 AI 模型至 Web 介面',
            '向主管與非技術人員 demo，將複雜架構概念轉化為具體效益',
          ],
        },
      ],
    },
    {
      title: '猿創力程式設計學校',
      role: '儲備講師',
      bullets: ['教導國中、國小學生程式，小班制 MCE、Python 為主', 'App Inventor 到府一對一比賽特訓班'],
    },
    {
      title: '私立高偉數學補習班',
      role: '資訊助理 & 企劃部門',
      bullets: [
        '開發補習班 Android App 並上線維運',
        '完成主管交辦的其他資訊事務',
        '剪輯數十支 10 分鐘內宣傳影片、製作封面',
      ],
    },
  ],
  'zh-CN': [
    {
      title: '微星科技股份有限公司',
      role: '软体工程师',
      groups: [
        {
          heading: '前端架构与标准化',
          items: [
            '主导导入 Monorepo 架构：用 Turborepo 整合内部多个前端项目，解决跨项目代码共用与版控痛点',
            '建立 ESLint / Prettier / TypeScript 严格规则，提升团队代码品质',
            '封装共用 UI Library 与 Utility Libraries，提供其他团队（如 IT Team）复用',
            '撰写标准化开发文档与 README，协助团队成员上手新架构',
          ],
        },
        {
          heading: '后端开发与维护',
          items: [
            '维护 ASP.NET (C#) 与 Legacy Web API，解决 .NET Framework 相容性与 .web.config 配置问题',
            '处理 MS SQL 数据库权限控管与 Stored Procedure 逻辑除错',
            '用 Python 撰写网页爬虫与自动化脚本，协助资料收集与批次处理',
          ],
        },
        {
          heading: 'DevOps 与流程优化',
          items: [
            '参与 GitLab CI/CD Pipeline 建置与维护，确保 Monorepo 自动化建置部署流畅',
            '熟悉 Git Flow，协助团队解决版本冲突与 Merge Request Code Review',
          ],
        },
        {
          heading: '跨部门协作',
          items: [
            '与 AI Team / IT Team 紧密合作，作为前端技术窗口整合 AI 模型至 Web 介面',
            '向主管与非技术人员 demo，将复杂架构概念转化为具体效益',
          ],
        },
      ],
    },
    {
      title: '猿创力程式设计学校',
      role: '储备讲师',
      bullets: ['教导国中、国小学生程式，小班制 MCE、Python 为主', 'App Inventor 到府一对一比赛特训班'],
    },
    {
      title: '私立高伟数学补习班',
      role: '资讯助理 & 企划部门',
      bullets: [
        '开发补习班 Android App 并上线维运',
        '完成主管交办的其他资讯事务',
        '剪辑数十支 10 分钟内宣传影片、制作封面',
      ],
    },
  ],
  en: [
    {
      title: 'MSI (Micro-Star International)',
      role: 'Software Engineer',
      groups: [
        {
          heading: 'Frontend Architecture & Standardization',
          items: [
            'Led the Monorepo migration: used Turborepo to consolidate multiple internal frontend projects, solving cross-project code sharing and versioning pain points',
            'Established strict ESLint / Prettier / TypeScript rules, raising team code quality',
            'Packaged shared UI libraries and utility libraries for reuse by other teams (e.g. IT Team)',
            'Wrote standardized dev docs and READMEs to help teammates onboard',
          ],
        },
        {
          heading: 'Backend Development & Maintenance',
          items: [
            'Maintained ASP.NET (C#) and legacy Web APIs — fixed .NET Framework compatibility and .web.config issues',
            'Handled MS SQL permissions and debugged Stored Procedures',
            'Wrote Python scrapers and automation scripts for data collection and batch processing',
          ],
        },
        {
          heading: 'DevOps & Process Optimization',
          items: [
            'Built and maintained GitLab CI/CD pipelines, ensuring smooth automated builds and deploys for the monorepo',
            'Comfortable with Git Flow, helping teammates resolve conflicts and reviewing merge requests',
          ],
        },
        {
          heading: 'Cross-Team Collaboration',
          items: [
            'Worked closely with AI Team / IT Team as the frontend tech contact integrating AI models into web interfaces',
            'Demoed to non-technical stakeholders, translating complex architecture into concrete value',
          ],
        },
      ],
    },
    {
      title: 'Ape Programming School',
      role: 'Reserve Instructor',
      bullets: [
        'Teach programming to elementary and junior-high students; small-class MCE and Python focused',
        "App Inventor one-on-one competition prep — taught at students' homes",
      ],
    },
    {
      title: 'Gao-Wei Math Cram School',
      role: 'IT Assistant & Planning',
      bullets: [
        'Built and maintained an Android app for the cram school in production',
        'Handled various IT tasks assigned by management',
        'Edited dozens of <10-min promo videos with thumbnails',
      ],
    },
  ],
  ja: [
    {
      title: 'MSI（微星科技）',
      role: 'ソフトウェアエンジニア',
      groups: [
        {
          heading: 'フロントエンドアーキテクチャと標準化',
          items: [
            'Monorepo への移行を主導：Turborepo で社内の複数のフロントエンドプロジェクトを統合し、コード共有とバージョン管理の課題を解決',
            'ESLint / Prettier / TypeScript の厳格なルールを策定し、チームのコード品質を向上',
            '共有 UI ライブラリと Utility ライブラリを整備し、他チーム（IT Team など）でも再利用',
            '標準化された開発ドキュメントと README を整備し、新メンバーの立ち上げを支援',
          ],
        },
        {
          heading: 'バックエンド開発と保守',
          items: [
            'ASP.NET (C#) とレガシー Web API を保守。.NET Framework 互換性や .web.config の設定問題を解決',
            'MS SQL の権限管理とストアドプロシージャのロジックデバッグを担当',
            'Python で Web スクレイパーと自動化スクリプトを作成し、データ収集とバッチ処理を支援',
          ],
        },
        {
          heading: 'DevOps とプロセス最適化',
          items: [
            'GitLab CI/CD パイプラインの構築・保守に参加し、Monorepo の自動ビルド・デプロイを円滑に',
            'Git Flow に精通し、チームのバージョン衝突解決と MR レビューを支援',
          ],
        },
        {
          heading: '部門間連携',
          items: [
            'AI Team / IT Team と密に連携し、フロントエンド技術窓口として AI モデルを Web 画面に統合',
            '上司や技術以外のメンバーへデモを行い、複雑なアーキテクチャの概念を具体的な価値へ翻訳',
          ],
        },
      ],
    },
    {
      title: '猿創力プログラミングスクール',
      role: '見習い講師',
      bullets: [
        '小・中学生にプログラミングを指導。少人数制で MCE・Python を中心に',
        'App Inventor の一対一コンテスト特訓を生徒の家まで出張',
      ],
    },
    {
      title: '私立高偉数学塾',
      role: 'IT アシスタント & 企画部',
      bullets: [
        '塾の Android アプリを開発し、本番運用までを担当',
        '上司から依頼された各種 IT 業務を処理',
        '10 分以内の宣伝動画を数十本編集し、サムネイルも制作',
      ],
    },
  ],
  ko: [
    {
      title: 'MSI(미신과학기)',
      role: '소프트웨어 엔지니어',
      groups: [
        {
          heading: '프런트엔드 아키텍처 및 표준화',
          items: [
            'Monorepo 도입 주도: Turborepo로 사내 여러 프런트엔드 프로젝트를 통합해 코드 공유와 버전 관리 문제를 해결',
            'ESLint / Prettier / TypeScript의 엄격한 규칙을 도입해 팀 코드 품질을 향상',
            '공용 UI 라이브러리와 Utility 라이브러리를 패키징하여 다른 팀(IT Team 등)에서 재사용 가능하게 제공',
            '표준화된 개발 문서와 README를 작성해 팀원들의 온보딩을 지원',
          ],
        },
        {
          heading: '백엔드 개발 및 유지보수',
          items: [
            'ASP.NET (C#)과 레거시 Web API를 유지보수하며 .NET Framework 호환성과 .web.config 설정 문제를 해결',
            'MS SQL의 권한 관리와 Stored Procedure 로직 디버깅을 담당',
            'Python으로 웹 스크레이퍼와 자동화 스크립트를 작성해 데이터 수집과 배치 처리를 지원',
          ],
        },
        {
          heading: '데브옵스 및 프로세스 최적화',
          items: [
            'GitLab CI/CD 파이프라인 구축·유지에 참여해 Monorepo의 자동 빌드와 배포가 매끄럽게 동작',
            'Git Flow에 능숙하며 팀의 버전 충돌 해결과 머지 리퀘스트 코드 리뷰를 도움',
          ],
        },
        {
          heading: '부서 간 협업',
          items: [
            'AI Team / IT Team과 긴밀히 협력하며 프런트엔드 기술 창구로서 AI 모델을 웹 인터페이스에 통합',
            '관리자와 비기술 인력에게 데모를 진행하여 복잡한 아키텍처 개념을 구체적인 가치로 전달',
          ],
        },
      ],
    },
    {
      title: '원창리 프로그래밍 스쿨',
      role: '예비 강사',
      bullets: [
        '초·중학생에게 프로그래밍을 지도. 소그룹제 MCE·Python 중심',
        'App Inventor 1:1 대회 특훈을 학생 집에 방문하여 진행',
      ],
    },
    {
      title: '사립 가오웨이 수학학원',
      role: 'IT 보조 & 기획부',
      bullets: [
        '학원 Android 앱을 개발하고 출시·운영까지 담당',
        '관리자에게 위임된 각종 IT 업무 처리',
        '10분 이내의 홍보 영상 수십 편을 편집하고 썸네일 제작',
      ],
    },
  ],
};

const WorkExperience = () => {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const list = lookupOr(EXPERIENCES_BY_LANG, lang, EXPERIENCES_BY_LANG['zh-TW']);
  const EXPERIENCES = list.map((e, i) => ({ ...e, period: PERIODS[i], tags: TAGS[i] }));
  return (
    <section id="work-experience" className="home-section work-v2">
      <div className="home-section-eyebrow">
        <span className="section-label">Experience</span>
        <span className="section-eyebrow-count">{EXPERIENCES.length} roles</span>
      </div>

      <div className="work-timeline">
        {EXPERIENCES.map((exp, i) => (
          <motion.article
            key={exp.title}
            className="work-entry"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
          >
            <aside className="work-rail">
              <span className="work-rail-dot" />
              <time className="work-period">{exp.period}</time>
            </aside>

            <div className="work-card glass-card">
              <header className="work-card-head">
                <h3 className="work-card-title">{exp.title}</h3>
                <span className="work-card-role">{exp.role}</span>
              </header>

              {exp.tags.length > 0 && (
                <div className="work-tags">
                  {exp.tags.map((t) => (
                    <span key={t} className="work-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {exp.groups && (
                <div className="work-groups">
                  {exp.groups.map((g) => (
                    <div key={g.heading} className="work-group">
                      <span className="section-label work-group-label">{g.heading}</span>
                      <ul className="work-bullets">
                        {g.items.map((it) => (
                          <li key={it}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {exp.bullets && (
                <ul className="work-bullets work-bullets-flat">
                  {exp.bullets.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
};

export default WorkExperience;
