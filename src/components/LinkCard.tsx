import { useQuery } from '@tanstack/react-query';
import type { IconType } from 'react-icons';
import { FaYoutube, FaGithub, FaInstagram, FaExternalLinkAlt } from 'react-icons/fa';
import { useLocale, LocaleLink } from '../locale-link';
import { recentPostsQueryOptions } from '../blogList';
import { thoughtDetailQueryOptions } from '../thoughtData';
import { postPath } from '../lib/postPath';

// 卡片形狀的載入骨架（保留與真卡相同的高度/結構）→ 資料未到時佔位不塌、client 補上時不位移。
const LinkCardSkeleton = () => (
  <span className="link-card link-card-internal link-card-skeleton" aria-hidden="true">
    <span className="link-card-body">
      <span className="link-card-site"><span className="bp-skel" style={{ width: 64, height: 12, display: 'inline-block' }} /></span>
      <span className="link-card-title"><span className="bp-skel" style={{ width: '70%', height: 16, display: 'block' }} /></span>
      <span className="link-card-meta"><span className="bp-skel" style={{ width: 90, height: 12, display: 'inline-block' }} /></span>
    </span>
  </span>
);

// 抽自 BlogPost：連結預覽卡 cluster。本身 SSR-safe（不碰 window/document），
// 與 mermaid 等 browser-only 依賴脫鉤，可在任何頁面（History/AboutSite/文章）直接 SSR。

interface LinkMeta {
  type: string;
  id?: string;
  icon?: IconType;
  color?: string;
  label?: string;
  thumb?: string | null;
  vid?: string;
  desc?: string;
  embedUrl?: string | null;
  bvid?: string;
  path?: string;
}


/* ── Link type detection ── */
const getLinkMeta = (url: string): LinkMeta | null => {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      let vid = '';
      if (host.includes('youtu.be')) vid = u.pathname.slice(1);
      else vid = u.searchParams.get('v') ?? '';
      return { type: 'youtube', icon: FaYoutube, color: '#ff0000', label: 'YouTube', thumb: vid ? 'https://img.youtube.com/vi/' + vid + '/mqdefault.jpg' : null, vid };
    }
    if (host.includes('github.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const repo = parts.length >= 2 ? parts[0] + '/' + parts[1] : u.pathname;

      // Better descriptions for common GitHub deep links.
      if (parts.length >= 4 && parts[2] === 'issues') {
        return {
          type: 'github',
          icon: FaGithub,
          color: '#fff',
          label: 'GitHub Issue',
          desc: repo + '#' + parts[3],
        };
      }

      if (parts.length >= 4 && (parts[2] === 'pull' || parts[2] === 'pulls')) {
        return {
          type: 'github',
          icon: FaGithub,
          color: '#fff',
          label: 'GitHub PR',
          desc: repo + '#' + parts[3],
        };
      }

      // Profile URL (只有 username 沒有 repo) → 標成「GitHub Profile」更直覺
      if (parts.length === 1) {
        return { type: 'github', icon: FaGithub, color: '#fff', label: 'GitHub Profile', desc: '@' + parts[0] };
      }
      return { type: 'github', icon: FaGithub, color: '#fff', label: 'GitHub', desc: repo };
    }
    if (host.includes('instagram.com')) return { type: 'instagram', icon: FaInstagram, color: '#E4405F', label: 'Instagram' };
    if (host.includes('threads.net')) return { type: 'threads', icon: FaExternalLinkAlt, color: '#fff', label: 'Threads' };

    // Spotify
    if (host.includes('spotify.com') || host.includes('open.spotify.com')) {
      // Extract Spotify embed URL
      const pathParts = u.pathname.split('/');
      let embedUrl = null;
      if (pathParts.includes('track') || pathParts.includes('album') || pathParts.includes('playlist') || pathParts.includes('episode')) {
        embedUrl = `https://open.spotify.com/embed${u.pathname}`;
      }
      return { type: 'spotify', icon: FaExternalLinkAlt, color: '#1DB954', label: 'Spotify', embedUrl };
    }

    // Bilibili
    if (host.includes('bilibili.com') || host.includes('b23.tv')) {
      let bvid = '';
      const bvMatch = /BV\w+/.exec(u.pathname);
      if (bvMatch) bvid = bvMatch[0];
      return { type: 'bilibili', icon: FaExternalLinkAlt, color: '#00A1D6', label: 'Bilibili', bvid };
    }

    // Internal Blog Link Detection — 含語系前綴（/en/blog/、/ko/blog/…）
    const blogMatch = /^(?:\/(?:en|zh-cn|ja|ko))?\/blog\/([^/]+)$/.exec(u.pathname);
    if (host.includes('koimsurai.com') && blogMatch) {
      const id = blogMatch[1];
      if (id && id !== 'blog') return { type: 'internal', id };
    }

    // 碎念 / 思考引用
    if (host.includes('koimsurai.com') && u.pathname.startsWith('/thinking/')) {
      const tid = u.pathname.split('/').pop();
      if (tid && tid !== 'thinking') return { type: 'thought', id: tid };
    }

    // Internal Web Link Detection (non-blog pages)
    if (host.includes('koimsurai.com')) {
      return { type: 'internal-page', icon: FaExternalLinkAlt, color: 'var(--post-accent)', label: '站內連結', path: u.pathname };
    }

    return { type: 'generic', icon: FaExternalLinkAlt, color: 'var(--post-muted)', label: host };
  } catch { return null; }
};

/* ══════════════════════════
   InternalLinkCard — fetch and show preview
   ══════════════════════════ */
export const InternalLinkCard = ({ id }: { id: string }) => {
  // 卡片只需 title / created_at / category —— 這些 recentPosts 清單就有，而文章 loader 已把該
  // 清單預取進快取 → SSR 首幀就是真卡片（不必為每個連結各打一次 post detail）。
  // 清單裡找不到（例如連到 top-100 之外）才退回骨架，且骨架保留高度 → 換上時不位移。
  const navLocale = useLocale();
  const { data: posts } = useQuery(recentPostsQueryOptions(100, navLocale));
  // 文章內的站內連結可能寫成 /blog/<id> 或 /blog/<slug>，兩種都要認得。
  const post = posts?.find((p) => String(p.id) === id || p.slug === id);

  if (!post) return <LinkCardSkeleton />;

  return (
    <LocaleLink to={postPath(post)} className="link-card link-card-internal">
      <div className="link-card-body">
        <div className="link-card-site">
          <span style={{ fontSize: '1rem', color: 'var(--post-accent)' }}>✦</span>
          <span>站內文章</span>
        </div>
        <div className="link-card-title">{post.title}</div>
        <div className="link-card-meta">
          {/* 年份直接取 ISO 字串前 4 碼（不經 Date/時區）→ SSR 與 client 一致，不 mismatch。 */}
          <span>{(post.created_at ?? '').slice(0, 4)}</span>
          {post.category && <> · <span>{post.category}</span></>}
        </div>
      </div>
    </LocaleLink>
  );
};

/* ══════════════════════════
   ThoughtPreviewCard — 引用一則碎念/思考
   ══════════════════════════ */
export const ThoughtPreviewCard = ({ id }: { id: string }) => {
  // 碎念引用卡：reuse thoughtDetailQueryOptions → 與 ThinkingDetail 共用快取。
  const { data: th } = useQuery(thoughtDetailQueryOptions(id));

  if (!th) return <LinkCardSkeleton />;

  return (
    <LocaleLink to={`/thinking/${id}`} className="link-card link-card-internal">
      <div className="link-card-body">
        <div className="link-card-site">
          <span style={{ fontSize: '1rem', color: 'var(--post-accent)' }}>✦</span>
          <span>碎念</span>
        </div>
        <div className="link-card-title" style={{ whiteSpace: 'normal', fontSize: '0.98rem' }}>
          {th.content.length > 80 ? th.content.slice(0, 80) + '…' : th.content}
        </div>
      </div>
    </LocaleLink>
  );
};

/* ══════════════════════════
   LinkCard — rich link preview
   ══════════════════════════ */
export const LinkCard = ({ href }: { href: string }) => {
  const meta = getLinkMeta(href);
  if (!meta) return <a href={href} target="_blank" rel="noopener noreferrer">{href}</a>;

  if (meta.type === 'internal') {
    return <InternalLinkCard id={meta.id ?? ''} />;
  }

  if (meta.type === 'thought') {
    return <ThoughtPreviewCard id={meta.id ?? ''} />;
  }

  // Spotify embed
  if (meta.type === 'spotify' && meta.embedUrl) {
    return (
      <div className="link-card link-card-spotify">
        <iframe
          src={meta.embedUrl + '?theme=0'}
          width="100%"
          height="152"
          frameBorder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="rounded-lg"
          style={{ border: 'none' }}
        />
      </div>
    );
  }

  // Bilibili embed
  if (meta.type === 'bilibili' && meta.bvid) {
    return (
      <div className="link-card link-card-bilibili">
        <div className="link-card-embed-wrapper">
          <iframe
            src={`https://player.bilibili.com/player.html?bvid=${meta.bvid}&high_quality=1&danmaku=0`}
            scrolling="no"
            frameBorder="0"
            allowFullScreen
            loading="lazy"
            className="link-card-bilibili-iframe"
            style={{ border: 'none' }}
          />
        </div>
        <a href={href} target="_blank" rel="noopener noreferrer" className="link-card-embed-link">
          <span style={{ color: '#00A1D6' }}>▶</span> 在 Bilibili 觀看
        </a>
      </div>
    );
  }

  // Internal web page link
  if (meta.type === 'internal-page') {
    return (
      <LocaleLink to={meta.path ?? '/'} className="link-card link-card-internal">
        <div className="link-card-body">
          <div className="link-card-site">
            <span style={{ fontSize: '1rem', color: 'var(--post-accent)' }}>✦</span>
            <span>{meta.label}</span>
          </div>
          <div className="link-card-url">{meta.path}</div>
        </div>
      </LocaleLink>
    );
  }

  const Icon = meta.icon;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={'link-card link-card-' + meta.type}>
      {meta.thumb && (
        <div className="link-card-thumb">
          <img src={meta.thumb} alt="" loading="lazy" />
        </div>
      )}
      <div className="link-card-body">
        <div className="link-card-site">
          {Icon && <Icon style={{ color: meta.color, fontSize: '1rem' }} />}
          <span>{meta.label}</span>
        </div>
        <div className="link-card-url">{meta.desc ?? href}</div>
      </div>
    </a>
  );
};
