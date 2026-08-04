/* MDX <Refs>：文末參考連結區。每列 = 標籤 + 一到多個連結；連結依網域自動帶**品牌色** icon
   （GitHub/npm/crates.io…，用 react-icons、不打外部 favicon → 對 CSP 友善），並跟站上其他連結一樣
   有 hover 預覽卡（LinkHoverPreview）。文字用中性色，避免跟彩色 icon 打架。 */
/* icon 從靜態 domain→component 表取（非 render 期建立）→ static-components 誤判，關該規則。 */
/* eslint-disable @eslint-react/static-components */
import type { IconType } from 'react-icons';
import { SiNpm, SiRust, SiPypi } from 'react-icons/si';
import { FaGithub, FaXTwitter, FaBookOpen, FaLink, FaYoutube } from 'react-icons/fa6';
import { LinkHoverPreview } from '@/components/common/LinkHoverPreview';

interface RefLink { text: string; href: string }
interface RefItem { label?: string; links?: RefLink[] }

// 依網域回傳品牌 icon + 深底可讀的品牌色。
function brandFor(href: string): { Icon: IconType; color: string } {
  let host = '';
  try { host = new URL(href, 'https://koimsurai.com').hostname.replace(/^www\./, ''); } catch { /* 無法解析 → 預設 */ }
  if (/(^|\.)github\.(com|io)$/.test(host)) return { Icon: FaGithub, color: '#e8e8ea' };
  if (host === 'npmjs.com') return { Icon: SiNpm, color: '#e15754' };
  if (host === 'crates.io') return { Icon: SiRust, color: '#e0aa82' };
  if (host === 'pypi.org') return { Icon: SiPypi, color: '#6ea8d8' };
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return { Icon: FaYoutube, color: '#ff5252' };
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return { Icon: FaXTwitter, color: '#e8e8ea' };
  if (host === 'koimsurai.com') return { Icon: FaBookOpen, color: '#a78bfa' }; // 站內文章
  return { Icon: FaLink, color: 'rgba(255,255,255,0.5)' };
}

export default function RefsBlock({ items = [], title = '參考連結' }: { items?: RefItem[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className="mdx-refs">
      {title ? <div className="mdx-refs-title">{title}</div> : null}
      <ul className="mdx-refs-list">
        {items.map((item, i) => (
          // 靜態清單、不重排 → index 併入 key 安全
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <li key={`${i}-${item.label ?? ''}`} className="mdx-refs-row">
            {item.label ? <span className="mdx-refs-label">{item.label}</span> : null}
            <span className="mdx-refs-links">
              {(item.links ?? []).map((l, j) => {
                const { Icon, color } = brandFor(l.href);
                return (
                  // 跟其他行內連結一樣有 hover 預覽卡；內/外部 target 由 LinkHoverPreview 處理
                  // eslint-disable-next-line @eslint-react/no-array-index-key
                  <LinkHoverPreview key={`${j}-${l.href}`} href={l.href} className="mdx-refs-link">
                    <Icon className="mdx-refs-icon" style={{ color }} aria-hidden />
                    <span>{l.text}</span>
                  </LinkHoverPreview>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
