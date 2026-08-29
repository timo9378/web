interface YearLabel {
  NOW: string;
  FUTURE: string;
}
interface JourneyUIText {
  title: string;
  subtitle: string;
  expand: string;
  collapse: string;
  endingTitle: string;
  endingText: string;
}
interface MilestoneStatic {
  id: number;
  year: string;
  icon: string;
  color: string;
  tags: string[];
}
interface MilestoneLang {
  title: string;
  subtitle: string;
  description: string;
  extraTags: string[];
}

// 成長軌跡資料 — 從舊 /journey 頁搬過來（頁面已汰汰、併入 /about）。
// icon/color/tags 穩定；title/subtitle/description 隨語系。

const YEAR_LABELS: Record<string, YearLabel> = {
  'zh-TW': { NOW: '現在', FUTURE: '未來' },
  'zh-CN': { NOW: '现在', FUTURE: '未来' },
  en: { NOW: 'Now', FUTURE: 'Future' },
  ja: { NOW: '今', FUTURE: '未来' },
  ko: { NOW: '지금', FUTURE: '미래' },
};

const JOURNEY_UI: Record<string, JourneyUIText> = {
  'zh-TW': {
    title: '我的成長軌跡',
    subtitle: '從第一行代碼到星辰大海，記錄每一個重要時刻',
    expand: '查看詳情 ▼',
    collapse: '收起 ▲',
    endingTitle: '旅程未完待續...',
    endingText: '每一次學習都是新的冒險，每一個專案都是新的挑戰。',
  },
  'zh-CN': {
    title: '我的成长轨迹',
    subtitle: '从第一行代码到星辰大海，记录每一个重要时刻',
    expand: '查看详情 ▼',
    collapse: '收起 ▲',
    endingTitle: '旅程未完待续...',
    endingText: '每一次学习都是新的冒险，每一个项目都是新的挑战。',
  },
  en: {
    title: 'My Journey',
    subtitle: 'From the first line of code to the stars — every moment that mattered.',
    expand: 'Read more ▼',
    collapse: 'Collapse ▲',
    endingTitle: 'To be continued...',
    endingText: 'Every new thing learned is a new adventure; every project is a new challenge.',
  },
  ja: {
    title: '私の歩み',
    subtitle: '最初の 1 行から星空まで、節目をすべて残しています',
    expand: '詳しく見る ▼',
    collapse: '閉じる ▲',
    endingTitle: '旅はまだ続きます...',
    endingText: '学ぶたびに新しい冒険、プロジェクトのたびに新しい挑戦です。',
  },
  ko: {
    title: '나의 여정',
    subtitle: '첫 줄의 코드에서 별바다까지, 모든 중요한 순간을 기록합니다',
    expand: '자세히 보기 ▼',
    collapse: '접기 ▲',
    endingTitle: '여정은 계속됩니다...',
    endingText: '배움은 곧 새로운 모험, 프로젝트는 곧 새로운 도전.',
  },
};

const MILESTONE_STATIC: MilestoneStatic[] = [
  { id: 1, year: '2004', icon: '🌟', color: '#c084fc', tags: ['Full-Stack', 'Photography', 'Design'] },
  { id: 2, year: '2019-2021', icon: '🍱', color: '#4ade80', tags: [] },
  { id: 3, year: '2022-2023', icon: '👥', color: '#60a5fa', tags: ['Python', 'Golang', 'Java'] },
  { id: 4, year: '2024.07', icon: '🎓', color: '#fb923c', tags: ['Python'] },
  { id: 5, year: '2024.09', icon: '📱', color: '#34d399', tags: ['Kotlin', 'Android', 'Premiere', 'GitHub'] },
  {
    id: 6,
    year: '2024',
    icon: '⚡',
    color: '#a78bfa',
    tags: ['Redis', 'FastAPI', 'Flutter', 'Docker', 'Nginx', 'Discord Bot'],
  },
  { id: 7, year: '2025', icon: '🏢', color: '#fbbf24', tags: ['Turborepo', 'Tauri', 'TypeScript', 'CI/CD'] },
  { id: 8, year: 'NOW', icon: '🔭', color: '#f472b6', tags: ['React', 'Three.js', 'Rust', 'NAS', 'UI/UX'] },
  { id: 9, year: 'FUTURE', icon: '🚀', color: '#ec4899', tags: [] },
];

const MILESTONES_BY_LANG: Record<string, MilestoneLang[]> = {
  'zh-TW': [
    {
      title: '出生',
      subtitle: '水瓶座 A 型',
      description:
        '出生於 2004 年。理性的程式邏輯與感性的美學設計——這兩種看似衝突的特質，讓我在開發前端介面與規劃系統架構時，能同時兼顧使用者的視覺體驗與程式碼的運作效率。',
      extraTags: ['全端工程師', '攝影', '設計'],
    },
    {
      title: '啟蒙與磨練',
      subtitle: '日本料理店內外場',
      description:
        '高中時期的第一份工作是在日本料理店擔任內外場人員。日本職人對於「備料規矩」與「服務禮儀」的嚴苛要求，深深影響了我日後的工作態度。即使在忙碌的高壓環境下，仍能保持冷靜依照 SOP 處理繁雜事務，培養出優異的時間管理能力與抗壓性。',
      extraTags: ['抗壓性', '工作素養', '時間管理'],
    },
    {
      title: '大學前期',
      subtitle: '跨領域探索與領導力養成',
      description:
        '進入大學後積極充實技術棧（Python, Golang, Java），並跳出舒適圈擔任系學會會長與吉他社文書。除了繁重課業，還需協調社團內的人力與資源，磨練了多工處理能力，學會帶領團隊、進行跨部門溝通，這些軟實力成為日後在職場上與不同 Team 協作的重要基石。',
      extraTags: ['領導', '團隊合作'],
    },
    {
      title: '程式教育經驗',
      subtitle: '猿創力程式設計學校',
      description:
        '大三時加入猿創力程式設計學校。面對 3~9 年級的學生與家長，必須將艱澀的程式邏輯轉化為淺顯易懂的語言，極大提升了溝通表達能力。教授 Python(pygame)、MCE、Scratch、AI2 等課程。',
      extraTags: ['教學', '溝通力'],
    },
    {
      title: 'APP 前端開發',
      subtitle: '高偉數學補習班 資訊助理',
      description:
        '負責 Android APP 前端開發 (Kotlin) 以及行銷影片剪輯 (Premiere)。在此期間開始接觸 GitHub 協作流程，學會版本控制基礎，並能獨立完成主管交辦的前端切版與功能實作。',
      extraTags: [],
    },
    {
      title: '大學專題',
      subtitle: 'EV 充電整合平台與遊戲化 ESG',
      description:
        '畢業專題目標是解決電動車車主需下載多個 APP 的痛點，打造整合各大充電樁平台的聚合服務。後端導入 Redis 快取優化地圖效能；使用 FastAPI 讀取車載 CAN Log 將行車歷程轉化為減碳積分；Flutter APP 首創「橫向捲軸遊戲化」介面傳遞 ESG 永續觀念。同時具備完整 Infra 能力——Docker 容器化、Nginx 反向代理、Cloudflare 防護、hMailServer 郵件服務。還開發了 Discord Bot 實現 ChatOps，團隊成員可直接下指令自動新增 Issue、即時監控 Server 狀態與 Log。',
      extraTags: [],
    },
    {
      title: '微星科技 (MSI) 實習',
      subtitle: '軟體工程師・架構標準化',
      description:
        '主導導入 Monorepo (Turborepo) 架構，解決跨專案代碼共用痛點，並建立 ESLint/Prettier/TypeScript 等嚴格規範。擔任前端技術窗口，與 AI Team 及 IT Team 密切合作，協助整合 AI 模型應用並參與 GitLab CI/CD 流程優化。近期正在導入 Tauri 將 Web 轉為桌面軟體，並嘗試 POC 推動公司 AI 專案到全世界。從「獨立開發者」晉升為具備「架構思維」的工程師。',
      extraTags: ['AI 整合'],
    },
    {
      title: '個人專案與持續進化',
      subtitle: '在網路世界保持上進心',
      description:
        '獨立使用 React 結合 Three.js 開發 3D 互動個人網站，展現不同於一般平面網頁的使用者體驗。因為對現有工具不滿意，主動自學 UI/UX 來優化專案；近期更開始研究 Rust 與 Home Lab (NAS) 領域，探索更底層的系統運作。',
      extraTags: [],
    },
    {
      title: '持續探索',
      subtitle: '打造穩定、高效且符合用戶需求的服務',
      description:
        '期許未來能發揮全端開發能力與架構經驗，不只是寫出會動的程式碼，而是打造出穩定、高效且符合用戶需求的優質服務。接觸不同類型產品與使用者，從前端到後端，從設計到部署，持續精進。',
      extraTags: ['全端開發', '架構設計', '成長'],
    },
  ],
  'zh-CN': [
    {
      title: '出生',
      subtitle: '水瓶座 A 型',
      description:
        '出生于 2004 年。理性的程式逻辑与感性的美学设计——这两种看似冲突的特质，让我在开发前端介面与规划系统架构时，能同时兼顾用户的视觉体验与程式码的运作效率。',
      extraTags: ['全端工程师', '摄影', '设计'],
    },
    {
      title: '启蒙与磨练',
      subtitle: '日式料理店内外场',
      description:
        '高中时期第一份工作是在日式料理店担任内外场。日本职人对「备料规矩」与「服务礼仪」的严苛要求，深深影响了我日后的工作态度。即使在忙碌的高压环境下，也能保持冷静依照 SOP 处理繁杂事务，培养出优异的时间管理能力与抗压性。',
      extraTags: ['抗压性', '工作素养', '时间管理'],
    },
    {
      title: '大学前期',
      subtitle: '跨领域探索与领导力养成',
      description:
        '进入大学后积极充实技术栈（Python、Golang、Java），并跳出舒适圈担任系学会会长与吉他社文书。除了繁重课业，还需协调社团内的人力与资源，磨练了多任务处理能力，学会带领团队、进行跨部门沟通，这些软实力成为日后在职场上与不同 Team 协作的重要基石。',
      extraTags: ['领导', '团队合作'],
    },
    {
      title: '程式教育经验',
      subtitle: '猿创力程式设计学校',
      description:
        '大三时加入猿创力程式设计学校。面对 3~9 年级的学生与家长，必须将艰涩的程式逻辑转化为浅显易懂的语言，极大提升了沟通表达能力。教授 Python(pygame)、MCE、Scratch、AI2 等课程。',
      extraTags: ['教学', '沟通力'],
    },
    {
      title: 'App 前端开发',
      subtitle: '高伟数学补习班 信息助理',
      description:
        '负责 Android App 前端开发 (Kotlin) 以及行销影片剪辑 (Premiere)。期间开始接触 GitHub 协作流程，学会版本控制基础，并能独立完成主管交办的前端切版与功能实作。',
      extraTags: [],
    },
    {
      title: '毕业专题',
      subtitle: 'EV 充电整合平台与游戏化 ESG',
      description:
        '毕业专题目标是解决电动车车主需下载多个 App 的痛点，打造整合各大充电桩平台的聚合服务。后端导入 Redis 快取优化地图效能；使用 FastAPI 读取车载 CAN Log 将行车历程转化为减碳积分；Flutter App 首创「横向卷轴游戏化」介面传递 ESG 永续观念。同时具备完整 Infra 能力——Docker 容器化、Nginx 反向代理、Cloudflare 防护、hMailServer 邮件服务。还开发了 Discord Bot 实现 ChatOps，团队成员可直接下命令自动新增 Issue、即时监控 Server 状态与 Log。',
      extraTags: [],
    },
    {
      title: '微星科技 (MSI) 实习',
      subtitle: '软体工程师・架构标准化',
      description:
        '主导导入 Monorepo (Turborepo) 架构，解决跨专案代码共用痛点，并建立 ESLint/Prettier/TypeScript 等严格规范。担任前端技术窗口，与 AI Team 及 IT Team 密切合作，协助整合 AI 模型应用并参与 GitLab CI/CD 流程优化。近期正在导入 Tauri 将 Web 转为桌面软体，并尝试 POC 将公司 AI 专案推向全世界。从「独立开发者」进化为具备「架构思维」的工程师。',
      extraTags: ['AI 整合'],
    },
    {
      title: '个人项目与持续进化',
      subtitle: '在网络世界保持上进心',
      description:
        '独立使用 React 结合 Three.js 开发 3D 互动个人网站，呈现不同于一般平面网页的用户体验。因为对现有工具不满意，主动自学 UI/UX 来优化项目；近期更开始研究 Rust 与 Home Lab (NAS) 领域，探索更底层的系统运作。',
      extraTags: [],
    },
    {
      title: '持续探索',
      subtitle: '打造稳定、高效且符合用户需求的服务',
      description:
        '期许未来能发挥全栈开发能力与架构经验，不只是写出会动的程式码，而是打造稳定、高效且符合用户需求的优质服务。接触不同类型产品与用户，从前端到后端，从设计到部署，持续精进。',
      extraTags: ['全栈开发', '架构设计', '成长'],
    },
  ],
  en: [
    {
      title: 'Born',
      subtitle: 'Aquarius · Blood type A',
      description:
        'Born in 2004. Rational programming logic and emotional aesthetic design — two seemingly contradictory traits that help me balance user experience and code efficiency when building frontend interfaces and planning system architecture.',
      extraTags: ['Full-Stack Engineer', 'Photography', 'Design'],
    },
    {
      title: 'First Step into Work',
      subtitle: 'Japanese restaurant — front & back of house',
      description:
        "High school: my first job was as front-and-back-of-house at a Japanese restaurant. The Japanese craftsperson's strict standards for 'prep discipline' and 'service etiquette' deeply shaped my work ethic. Even in fast, high-pressure environments, I learned to stay calm, follow SOP, and handle complex tasks — building strong time management and stress resilience.",
      extraTags: ['Resilience', 'Work ethic', 'Time management'],
    },
    {
      title: 'Early College',
      subtitle: 'Cross-domain exploration & leadership',
      description:
        'Once in college I actively expanded my tech stack (Python, Golang, Java) and pushed myself out of my comfort zone to serve as IM student-council president and as secretary of the guitar club. Beyond a heavy course load, I had to coordinate people and resources across these clubs — sharpening multitasking, learning to lead teams and communicate across groups. These soft skills became the foundation for cross-team collaboration in my later jobs.',
      extraTags: ['Leadership', 'Teamwork'],
    },
    {
      title: 'Teaching Programming',
      subtitle: 'Ape Programming School',
      description:
        'Joined Ape Programming School in junior year. Teaching K-9 students and their parents forced me to translate dense programming logic into clear, simple language — a huge boost to my communication skills. I taught Python (pygame), MCE, Scratch, and AI2.',
      extraTags: ['Teaching', 'Communication'],
    },
    {
      title: 'App Frontend Dev',
      subtitle: 'Gao-Wei Math Cram School — IT Assistant',
      description:
        'Built the Android app frontend in Kotlin and edited marketing videos in Premiere. This was where I first got into GitHub collaboration — version control basics — and could independently ship the UI cuts and features assigned to me.',
      extraTags: [],
    },
    {
      title: 'Capstone Project',
      subtitle: 'EV charging platform + gamified ESG',
      description:
        'Goal: solve the pain of EV drivers needing multiple apps — by building an aggregator across major charging-station platforms. Backend used Redis caching to optimize map performance; FastAPI parsed in-car CAN logs to convert driving trips into carbon-reduction points; the Flutter app pioneered a "horizontal-scroll gamified" UI to convey ESG sustainability concepts. We also had full infra: Docker containers, Nginx reverse proxy, Cloudflare protection, hMailServer email. Plus a Discord Bot for ChatOps — teammates could open issues, monitor server status, and tail logs via Discord commands.',
      extraTags: [],
    },
    {
      title: 'MSI Internship',
      subtitle: 'Software Engineer · architecture standardization',
      description:
        'Led the Monorepo (Turborepo) migration, solving cross-project code sharing pains, and established strict ESLint/Prettier/TypeScript rules. As the frontend tech contact, I worked closely with AI Team and IT Team — helping integrate AI models and participating in GitLab CI/CD optimization. Recently working on Tauri to convert web into desktop, and a PoC to push company AI projects globally. Grew from "indie developer" into an engineer with "architectural thinking".',
      extraTags: ['AI Integration'],
    },
    {
      title: 'Personal Projects & Continuous Growth',
      subtitle: 'Staying hungry online',
      description:
        'Independently built a 3D interactive personal site using React + Three.js, presenting a UX different from typical flat pages. Unsatisfied with existing tools, I taught myself UI/UX to improve my projects; lately diving into Rust and Home Lab (NAS), exploring lower-level systems.',
      extraTags: [],
    },
    {
      title: 'Keep Exploring',
      subtitle: 'Building stable, efficient, user-fit services',
      description:
        'Looking ahead, I want my full-stack skills and architectural experience to ship not just working code, but solid, efficient services that fit real users. Working across product types and users, from frontend to backend, from design to deploy, growing constantly.',
      extraTags: ['Full-Stack', 'Architecture', 'Growth'],
    },
  ],
  ja: [
    {
      title: '誕生',
      subtitle: '水瓶座・A 型',
      description:
        '2004 年生まれ。論理的なプログラミングの思考と、感性的な美のセンス——一見矛盾するこの二つの性質が、フロントエンドの UI を作るときも、システム設計を組むときも、利用者の体験とコードの効率を両立する助けになっています。',
      extraTags: ['フルスタックエンジニア', '写真', 'デザイン'],
    },
    {
      title: '原点と修練',
      subtitle: '日本料理店のホール・キッチン',
      description:
        '高校時代の最初の仕事は、日本料理店でホールとキッチンを担当することでした。日本の職人が「仕込みの作法」や「接客の礼儀」に求める厳しさが、その後の仕事への姿勢に深く影響しています。忙しく高プレッシャーな現場でも、冷静に SOP に沿って多くの作業を処理し、優れた時間管理力とストレス耐性を身につけました。',
      extraTags: ['ストレス耐性', '仕事の素養', '時間管理'],
    },
    {
      title: '大学前期',
      subtitle: '分野横断の探究とリーダーシップ',
      description:
        '大学に入ると技術スタック（Python・Golang・Java）を積極的に拡張し、舒適ゾーンを抜けて情報管理学生会長とギター部書記を引き受けました。授業に加えて、サークル内の人員とリソースを調整することで、マルチタスクの力、チームを率いる力、部門横断の調整力を磨きました。これらのソフトスキルが、後に職場で異なる Team と協働するうえでの大事な基礎になっています。',
      extraTags: ['リーダーシップ', 'チームワーク'],
    },
    {
      title: 'プログラミング教育',
      subtitle: '猿創力プログラミングスクール',
      description:
        '大学 3 年で猿創力プログラミングスクールに参加。小・中学生とその保護者と向き合う中で、難解なロジックを平易な言葉に翻訳する必要があり、コミュニケーション力が大きく伸びました。Python(pygame)・MCE・Scratch・AI2 などを担当。',
      extraTags: ['教育', 'コミュニケーション'],
    },
    {
      title: 'App フロントエンド開発',
      subtitle: '高偉数学塾 IT アシスタント',
      description:
        'Android アプリのフロント（Kotlin）と、宣伝動画の編集（Premiere）を担当。この頃から GitHub の協業フローに触れ、バージョン管理の基本を身につけ、上司から依頼された UI 切り出しや機能を独力で実装できるようになりました。',
      extraTags: [],
    },
    {
      title: '卒業課題',
      subtitle: 'EV 充電統合プラットフォーム + ESG ゲーミフィケーション',
      description:
        '卒業課題のテーマは、EV ドライバーが充電のたびに複数のアプリを使い分ける痛みを解消すること。各社の充電スタンドプラットフォームを束ねるアグリゲーターを作りました。バックエンドでは Redis でマップ性能をキャッシュ最適化し、FastAPI で車載 CAN ログを読み取り、走行履歴を CO2 削減ポイントに変換。Flutter アプリでは「横スクロールのゲーミフィケーション UI」で ESG の考え方を伝えました。インフラも一通り：Docker コンテナ化、Nginx リバプロ、Cloudflare、hMailServer。Discord Bot で ChatOps も実装し、メンバーがコマンドで Issue を作成・サーバー監視・ログ閲覧できるようにしました。',
      extraTags: [],
    },
    {
      title: 'MSI（微星科技）インターン',
      subtitle: 'ソフトウェアエンジニア・アーキテクチャ標準化',
      description:
        'Monorepo（Turborepo）への移行を主導し、プロジェクト横断のコード共有問題を解決、ESLint/Prettier/TypeScript の厳格なルールを整備。フロントエンドの技術窓口として AI Team・IT Team と密に連携し、AI モデル統合や GitLab CI/CD 最適化に参加。最近は Tauri で Web をデスクトップ化する取り組みや、会社の AI プロジェクトを世界へ展開する PoC を推進中。「個人開発者」から「アーキテクチャ思考をもつエンジニア」へ成長しました。',
      extraTags: ['AI 統合'],
    },
    {
      title: '個人プロジェクトと進化',
      subtitle: 'ネット世界で向上心を持ち続ける',
      description:
        '一人で React と Three.js を組み合わせて 3D インタラクティブな個人サイトを制作。一般的なフラットな Web とは違う体験を提示しました。既存ツールに満足できず、UI/UX を独学してプロジェクトを磨いていますし、最近は Rust とホームラボ（NAS）の領域に踏み込み、より低レイヤーのシステムを探究しています。',
      extraTags: [],
    },
    {
      title: '探究は続く',
      subtitle: '安定し、高効率で、ユーザー要件に合う良いサービスを',
      description:
        '今後は、フルスタックの実装力とアーキテクチャの経験を活かして、「動くコード」だけでなく「安定して、高速で、ユーザーに本当に合う」良いサービスを作りたいです。違う種類のプロダクトと利用者に触れ、フロントエンドからバックエンドまで、デザインからデプロイまで、磨き続けます。',
      extraTags: ['フルスタック', 'アーキテクチャ', '成長'],
    },
  ],
  ko: [
    {
      title: '출생',
      subtitle: '물병자리 · A형',
      description:
        '2004년에 태어났어요. 이성적인 프로그래밍 논리와 감성적인 미적 디자인 — 언뜻 모순돼 보이는 두 가지 특질이, 프런트엔드 UI를 만들 때도, 시스템 아키텍처를 설계할 때도, 사용자의 시각 경험과 코드의 효율을 동시에 챙기는 데 도움이 됩니다.',
      extraTags: ['풀스택 엔지니어', '사진', '디자인'],
    },
    {
      title: '시작과 단련',
      subtitle: '일식당 홀·주방',
      description:
        '고등학생 때 첫 일은 일식당의 홀과 주방을 맡는 일이었어요. 일본 장인의 「준비의 규율」과 「서비스 예절」에 대한 엄격한 기준이 이후의 업무 태도에 깊이 영향을 줬습니다. 바쁘고 압박이 큰 환경에서도 침착하게 SOP에 따라 복잡한 일을 처리하며, 시간 관리와 스트레스 내성을 길렀어요.',
      extraTags: ['스트레스 내성', '업무 소양', '시간 관리'],
    },
    {
      title: '대학 초기',
      subtitle: '분야 횡단 탐색과 리더십',
      description:
        '대학에 들어와 기술 스택(Python·Golang·Java)을 적극적으로 넓혔고, 안전지대를 벗어나 학과 학생회장과 기타 동아리 서기를 맡았습니다. 무거운 학업 외에도 동아리의 인력과 자원을 조율하면서 멀티태스킹 능력, 팀 리드, 부서 간 소통을 익혔고, 이 소프트 스킬이 이후 직장에서 다양한 팀과 협업하는 든든한 기반이 됐어요.',
      extraTags: ['리더십', '팀워크'],
    },
    {
      title: '프로그래밍 교육 경험',
      subtitle: '원창리 프로그래밍 스쿨',
      description:
        '대학 3학년 때 원창리 프로그래밍 스쿨에 합류. 초·중학생 학생과 학부모를 마주하며, 난해한 프로그래밍 로직을 알기 쉬운 언어로 옮기는 일을 반복하며 의사소통 능력이 크게 늘었습니다. Python(pygame)·MCE·Scratch·AI2 등을 가르쳤어요.',
      extraTags: ['교육', '커뮤니케이션'],
    },
    {
      title: '앱 프런트엔드 개발',
      subtitle: '가오웨이 수학학원 IT 보조',
      description:
        'Kotlin으로 Android 앱 프런트엔드를 담당하고, Premiere로 홍보 영상도 편집했어요. 이 시기에 GitHub 협업 흐름을 처음 접하며 버전 관리 기본을 익혔고, 관리자에게 위임된 UI 작업과 기능 구현을 독립적으로 수행할 수 있게 됐습니다.',
      extraTags: [],
    },
    {
      title: '졸업 프로젝트',
      subtitle: 'EV 충전 통합 플랫폼 + ESG 게이미피케이션',
      description:
        '졸업 프로젝트는 전기차 운전자가 충전마다 여러 앱을 오가야 하는 불편을 해결하는 것이 목표. 주요 충전소 플랫폼을 통합한 애그리게이터를 만들었어요. 백엔드는 Redis 캐시로 지도 성능을 최적화했고, FastAPI로 차량 CAN 로그를 읽어 주행 이력을 탄소 절감 포인트로 변환. Flutter 앱에서는 「가로 스크롤 게이미피케이션」 UI로 ESG 지속가능성 개념을 전달했죠. 인프라도 풀세트로 — Docker 컨테이너화, Nginx 리버스 프록시, Cloudflare 방어, hMailServer 메일 서비스. Discord Bot으로 ChatOps도 구현해 팀원이 명령으로 이슈를 만들고 서버 상태와 로그를 실시간으로 확인할 수 있게 했습니다.',
      extraTags: [],
    },
    {
      title: 'MSI(미신과학기) 인턴',
      subtitle: '소프트웨어 엔지니어 · 아키텍처 표준화',
      description:
        'Monorepo(Turborepo) 도입을 주도해 프로젝트 간 코드 공유 문제를 해결하고, ESLint/Prettier/TypeScript 등 엄격한 규칙을 세웠어요. 프런트엔드 기술 창구로서 AI Team과 IT Team과 긴밀히 협력해 AI 모델 통합과 GitLab CI/CD 최적화에 참여. 최근에는 Tauri로 웹을 데스크톱화하는 작업과, 회사 AI 프로젝트를 전 세계로 확장하는 PoC를 진행 중입니다. 「독립 개발자」에서 「아키텍처 사고를 갖춘 엔지니어」로 성장했어요.',
      extraTags: ['AI 통합'],
    },
    {
      title: '개인 프로젝트와 지속적인 성장',
      subtitle: '온라인 세상에서 향상심을 유지',
      description:
        '혼자서 React와 Three.js를 결합한 3D 인터랙티브 개인 사이트를 만들어, 일반적인 평면 웹과는 다른 사용자 경험을 보여줬습니다. 기존 도구가 만족스럽지 않아 UI/UX를 독학으로 익혀 프로젝트를 다듬고 있고, 요즘은 Rust와 Home Lab(NAS) 영역에 들어가 더 낮은 레벨의 시스템을 탐구하고 있어요.',
      extraTags: [],
    },
    {
      title: '계속해서 탐험',
      subtitle: '안정적이고 효율적이며 사용자 니즈에 맞는 서비스',
      description:
        '앞으로는 풀스택 구현력과 아키텍처 경험으로, 단순히 「돌아가는 코드」가 아니라 「안정적이고 효율적이며 사용자 니즈에 맞는」 좋은 서비스를 만들고 싶어요. 다양한 종류의 제품과 사용자를 마주하며, 프런트엔드부터 백엔드까지, 디자인부터 배포까지 꾸준히 다듬어 가고 싶습니다.',
      extraTags: ['풀스택', '아키텍처', '성장'],
    },
  ],
};

export { YEAR_LABELS, JOURNEY_UI, MILESTONE_STATIC, MILESTONES_BY_LANG };
