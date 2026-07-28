import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  SiFigma, SiDart, SiMongodb, SiAdobepremierepro, SiAdobelightroom, SiKotlin,
  SiNotion, SiCanva, SiReact, SiJavascript, SiTypescript, SiDotnet, SiC,
  SiCplusplus, SiGo, SiAdobephotoshop, SiAdobeillustrator, SiHtml5, SiCss3,
  SiNextdotjs, SiTailwindcss, SiSqlite, SiPostgresql, SiRust, SiExpress,
  SiMarkdown, SiN8N, SiNginx, SiTraefikproxy, SiVite, SiFramer, SiThreedotjs,
  SiSpringboot, SiTurborepo, SiPnpm, SiEslint, SiPrettier, SiGitlab, SiFlutter,
  SiNodedotjs, SiFastapi, SiJetpackcompose, SiTauri, SiRedis, SiFirebase,
  SiMermaid, SiObsidian, SiDiscord, SiGnubash, SiJsonwebtokens, SiScratch,
  SiAndroid, SiWebgl, SiPostman, SiCloudflare, SiVitest, SiPwa,
  SiBootstrap, SiPydantic, SiJinja, SiClaude, SiGooglegemini, SiOpenai, SiGithubcopilot,
} from 'react-icons/si';
import {
  FaJava, FaPython, FaLinux, FaGithub, FaDocker, FaNetworkWired,
  FaDatabase, FaTerminal, FaCube, FaGamepad, FaLock,
  FaPuzzlePiece,
} from 'react-icons/fa6';
import { TbBrandOauth } from 'react-icons/tb';
import { MdHttp } from 'react-icons/md';
import {
  IconCursor, IconAntigravity, IconCodex, IconMcp, IconVscode,
  IconWebsocket, IconPlaywright, IconJson, IconDns, IconCdn,
} from './BrandIcons';
import './Expertise.css';
import type { ComponentType, CSSProperties } from 'react';
import { pickByLang } from '../lib/pickByLang';

type IconComp = ComponentType<{ className?: string; style?: CSSProperties }>;

// Each entry: [Icon, brandColor]. Color preserved per react-icons convention
// so the marquee looks like a constellation of brand chips, not monochrome.
const ICON_MAP: Record<string, [IconComp, string]> = {
  'Next.js':         [SiNextdotjs,     '#ffffff'],
  'React':           [SiReact,         '#61DAFB'],
  'TypeScript':      [SiTypescript,    '#3178C6'],
  'JavaScript':      [SiJavascript,    '#F7DF1E'],
  'Vite':            [SiVite,          '#646CFF'],
  'Framer Motion':   [SiFramer,        '#FF4F8E'],
  'Three.js':        [SiThreedotjs,    '#ffffff'],
  'WebGL':           [SiWebgl,         '#990000'],
  'Tauri':           [SiTauri,         '#FFC131'],
  'PWA':             [SiPwa,           '#5A0FC8'],
  'Bootstrap':       [SiBootstrap,     '#7952B3'],
  'Tailwind CSS':    [SiTailwindcss,   '#06B6D4'],
  'HTML5':           [SiHtml5,         '#E34F26'],
  'CSS3':            [SiCss3,          '#1572B6'],

  'Rust':            [SiRust,          '#CE422B'],
  'Express':         [SiExpress,       '#ffffff'],
  'Node.js':         [SiNodedotjs,     '#5FA04E'],
  'ASP.NET':         [SiDotnet,        '#5C2D91'],
  '.NET 8':          [SiDotnet,        '#512BD4'],
  'Spring Boot':     [SiSpringboot,    '#6DB33F'],
  'FastAPI':         [SiFastapi,       '#009688'],
  'Go':              [SiGo,            '#00ADD8'],
  'Java':            [FaJava,          '#ED8B00'],
  'Python':          [FaPython,        '#3776AB'],
  'C++':             [SiCplusplus,     '#00599C'],
  'C':               [SiC,             '#A8B9CC'],
  'Pydantic':        [SiPydantic,      '#E92063'],
  'Jinja2':          [SiJinja,         '#B41717'],
  /* Python snake in Discord blurple — visually says "Python lib for
     Discord" at a glance without confusing it with the Discord app. */
  'discord.py':      [FaPython,        '#5865F2'],

  'Kotlin':          [SiKotlin,        '#7F52FF'],
  'Android':         [SiAndroid,       '#3DDC84'],
  'Jetpack Compose': [SiJetpackcompose,'#4285F4'],
  'Flutter':         [SiFlutter,       '#02569B'],
  'Dart':            [SiDart,          '#0175C2'],

  'Docker':          [FaDocker,        '#2496ED'],
  'Turborepo':       [SiTurborepo,     '#EF4444'],
  'pnpm':            [SiPnpm,          '#F69220'],
  'ESLint':          [SiEslint,        '#4B32C3'],
  'Prettier':        [SiPrettier,      '#F7B93E'],
  'GitLab CI/CD':    [SiGitlab,        '#FC6D26'],
  'GitHub':          [FaGithub,        '#ffffff'],
  'n8n':             [SiN8N,           '#EA4B71'],
  'Nginx':           [SiNginx,         '#009639'],
  'Traefik':         [SiTraefikproxy,  '#24A1C1'],
  'Linux':           [FaLinux,         '#FCC624'],
  'Bash':            [SiGnubash,       '#4EAA25'],
  'PowerShell':      [FaTerminal,      '#5391FE'],
  'Cloudflare':      [SiCloudflare,    '#F38020'],
  'Vitest':          [SiVitest,        '#6E9F18'],
  'Playwright':      [IconPlaywright,  '#2EAD33'],

  'Figma':           [SiFigma,         '#F24E1E'],
  'Photoshop':       [SiAdobephotoshop,'#31A8FF'],
  'Illustrator':     [SiAdobeillustrator,'#FF9A00'],
  'Premiere Pro':    [SiAdobepremierepro,'#9999FF'],
  'Lightroom':       [SiAdobelightroom,'#31A8FF'],

  'PostgreSQL':      [SiPostgresql,    '#4169E1'],
  'MS SQL Server':   [FaDatabase,      '#CC2927'],
  'MongoDB':         [SiMongodb,       '#47A248'],
  'SQLite':          [SiSqlite,        '#5099D8'],
  'Redis':           [SiRedis,         '#DC382D'],
  'Firebase':        [SiFirebase,      '#FFCA28'],
  'JSON':            [IconJson,        '#cbd5e1'],

  'DNS':             [IconDns,         '#79b8ff'],
  'SSL/TLS':         [FaLock,          '#22c55e'],
  'OAuth':           [TbBrandOauth,    '#c084fc'],
  'JWT':             [SiJsonwebtokens, '#FB015B'],
  'WebSocket':       [IconWebsocket,   '#56b6c2'],
  'CDN':             [IconCdn,         '#79b8ff'],
  'HTTP/HTTPS':      [MdHttp,          '#79b8ff'],
  'TCP/IP':          [FaNetworkWired,  '#79b8ff'],

  'Markdown':        [SiMarkdown,      '#ffffff'],
  'Notion':          [SiNotion,        '#ffffff'],
  'Mermaid':         [SiMermaid,       '#FF3670'],
  'Obsidian':        [SiObsidian,      '#7C3AED'],
  'Canva':           [SiCanva,         '#00C4CC'],
  'Discord':         [SiDiscord,       '#5865F2'],
  'VS Code':         [IconVscode,      '#007ACC'],
  'Postman':         [SiPostman,       '#FF6C37'],

  'Scratch':         [SiScratch,       '#FF6900'],
  'pygame':          [FaGamepad,       '#5DBE68'],
  'MCE (Minecraft)': [FaCube,          '#62B47A'],
  'App Inventor':    [FaPuzzlePiece,   '#3CA4D9'],

  'Claude':          [SiClaude,        '#DA7756'],
  'Gemini':          [SiGooglegemini,  '#4285F4'],
  'GPT':             [SiOpenai,        '#ffffff'],
  'Codex CLI':       [IconCodex,       '#ffffff'],
  'GitHub Copilot':  [SiGithubcopilot, '#1F88E5'],
  'Cursor':          [IconCursor,      '#ffffff'],
  'Antigravity':     [IconAntigravity, '#4285F4'],
  'MCP':             [IconMcp,         '#c084fc'],
};

// 中文名稱 per locale。label 是英文鍵,items 是技術名（不翻）。
const NAMES_BY_LANG: Record<string, Record<string, string>> = {
  'zh-TW': { Frontend: '前端開發', Backend: '後端開發', Mobile: '行動開發', DevOps: '部署運維', Design: '設計多媒體', Data: '資料儲存', Network: '網路通訊', Productivity: '生產力', 'AI Tools': 'AI 開發', Teaching: '教學工具' },
  'zh-CN': { Frontend: '前端开发', Backend: '后端开发', Mobile: '移动开发', DevOps: '部署运维', Design: '设计多媒体', Data: '数据存储', Network: '网络通讯', Productivity: '生产力', 'AI Tools': 'AI 开发', Teaching: '教学工具' },
  en:      { Frontend: 'Frontend', Backend: 'Backend', Mobile: 'Mobile', DevOps: 'DevOps', Design: 'Design', Data: 'Data', Network: 'Network', Productivity: 'Productivity', 'AI Tools': 'AI Tools', Teaching: 'Teaching' },
  ja:      { Frontend: 'フロントエンド', Backend: 'バックエンド', Mobile: 'モバイル', DevOps: 'DevOps', Design: 'デザイン・メディア', Data: 'データストア', Network: 'ネットワーク', Productivity: '生産性', 'AI Tools': 'AI 開発', Teaching: '教育ツール' },
  ko:      { Frontend: '프런트엔드', Backend: '백엔드', Mobile: '모바일', DevOps: '데브옵스', Design: '디자인 · 미디어', Data: '데이터 저장', Network: '네트워크', Productivity: '생산성', 'AI Tools': 'AI 개발', Teaching: '교육 도구' },
};

const HERO_BY_LANG: Record<string, { line1: string; line2: string }> = {
  'zh-TW': { line1: '從前端到部署、從設計到教學。', line2: '每一層都能自己接起來。' },
  'zh-CN': { line1: '从前端到部署、从设计到教学。', line2: '每一层都能自己接起来。' },
  en:      { line1: 'From frontend to deploy, from design to teaching.', line2: 'Every layer, I can wire it myself.' },
  ja:      { line1: 'フロントエンドからデプロイまで、デザインから教育まで。', line2: 'どの層も自分で繋げられる。' },
  ko:      { line1: '프런트엔드부터 배포까지, 디자인부터 교육까지.', line2: '모든 레이어를 직접 연결할 수 있어요.' },
};

const CATEGORIES_BASE: { label: string; items: string[] }[] = [
  { label: 'Frontend',     items: ['Next.js', 'React', 'TypeScript', 'JavaScript', 'Vite', 'Framer Motion', 'Three.js', 'WebGL', 'Tauri', 'PWA', 'Tailwind CSS', 'Bootstrap', 'HTML5', 'CSS3'] },
  { label: 'Backend',      items: ['Rust', 'Express', 'Node.js', 'ASP.NET', '.NET 8', 'Spring Boot', 'FastAPI', 'Pydantic', 'Jinja2', 'discord.py', 'Go', 'Java', 'Python', 'C++', 'C'] },
  { label: 'Mobile',       items: ['Kotlin', 'Android', 'Jetpack Compose', 'Flutter', 'Dart'] },
  { label: 'DevOps',       items: ['Docker', 'Cloudflare', 'Turborepo', 'pnpm', 'ESLint', 'Prettier', 'Vitest', 'Playwright', 'GitLab CI/CD', 'GitHub', 'n8n', 'Nginx', 'Traefik', 'Linux', 'Bash', 'PowerShell'] },
  { label: 'Design',       items: ['Figma', 'Photoshop', 'Illustrator', 'Premiere Pro', 'Lightroom'] },
  { label: 'Data',         items: ['PostgreSQL', 'MS SQL Server', 'MongoDB', 'SQLite', 'Redis', 'Firebase', 'JSON'] },
  { label: 'Network',      items: ['HTTP/HTTPS', 'TCP/IP', 'DNS', 'SSL/TLS', 'OAuth', 'JWT', 'WebSocket', 'CDN'] },
  { label: 'Productivity', items: ['VS Code', 'Postman', 'Notion', 'Obsidian', 'Markdown', 'Mermaid', 'Canva', 'Discord'] },
  { label: 'AI Tools',     items: ['Claude', 'Cursor', 'GitHub Copilot', 'Antigravity', 'Gemini', 'GPT', 'Codex CLI', 'MCP'] },
  { label: 'Teaching',     items: ['Scratch', 'pygame', 'MCE (Minecraft)', 'App Inventor'] },
];

const CATEGORIES = CATEGORIES_BASE; // 元件 render 時用 i18n 動態接 name

const TOTAL = CATEGORIES.reduce((sum, c) => sum + c.items.length, 0);

const SkillIcon = ({ name }: { name: string }) => {
  const entry = ICON_MAP[name];
  if (!entry) return null;
  const [Icon, color] = entry;
  return (
    <span className="skill-chip" title={name} aria-label={name}>
      <Icon className="skill-chip-icon" style={{ color }} />
    </span>
  );
};

// Auto-scrolling marquee for long lists; static row for short ones so
// the loop doesn't visibly repeat the same icons within the viewport.
const MIN_FOR_MARQUEE = 7;

const MarqueeRow = ({ items, reverse, duration }: { items: string[]; reverse?: boolean; duration: number }) => (
  <div className="expertise-marquee-wrap">
    <div
      className="expertise-marquee-track"
      style={{
        animationDuration: `${duration}s`,
        animationDirection: reverse ? 'reverse' : 'normal',
      }}
    >
      {[...items, ...items].map((item, i) => (
        // 跑馬燈把 items 接兩份 → 同名項目必然重複，只能靠 index 區分前後兩份
        // eslint-disable-next-line @eslint-react/no-array-index-key
        <SkillIcon key={`${item}-${i}`} name={item} />
      ))}
    </div>
  </div>
);

const StaticRow = ({ items }: { items: string[] }) => (
  <div className="expertise-static-row">
    {items.map((item) => (
      <SkillIcon key={item} name={item} />
    ))}
  </div>
);

function Expertise() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const names = pickByLang(NAMES_BY_LANG, lang, NAMES_BY_LANG['zh-TW']);
  const hero = pickByLang(HERO_BY_LANG, lang, HERO_BY_LANG['zh-TW']);
  return (
    <section id="expertise" className="home-section expertise-v2">
      <div className="home-section-eyebrow">
        <span className="section-label">Stack</span>
        <span className="section-eyebrow-count">{CATEGORIES.length} domains · {TOTAL} technologies</span>
      </div>

      <div className="expertise-grid">
        <motion.div
          className="expertise-hero"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <span className="expertise-hero-number">{TOTAL}</span>
          <span className="expertise-hero-unit">technologies</span>
          <p className="expertise-hero-blurb">
            {hero.line1}<br />
            {hero.line2}
          </p>
        </motion.div>

        <div className="expertise-rows">
          {CATEGORIES.map((cat, i) => {
            const useMarquee = cat.items.length >= MIN_FOR_MARQUEE;
            const duration = Math.max(22, cat.items.length * 3.2);
            return (
              <motion.div
                key={cat.label}
                className="expertise-row"
                initial={{ opacity: 0, x: 12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.4, delay: i * 0.05, ease: 'easeOut' }}
              >
                <div className="expertise-row-label">
                  <span className="section-label">{cat.label}</span>
                  <span className="expertise-row-name">{names[cat.label]}</span>
                </div>
                {useMarquee
                  ? <MarqueeRow items={cat.items} reverse={i % 2 === 1} duration={duration} />
                  : <StaticRow items={cat.items} />}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default Expertise;
