import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, queryOptions } from '@tanstack/react-query';
import { apiUrl } from '../api';
import './link-hover-preview.css';

/**
 * 內文連結的 hover 預覽卡（Aceternity LinkPreview 的視覺，但資料自架）。
 *
 * 為什麼不用 Aceternity 預設的 microlink：那會把「讀者 hover 了哪個連結」送到第三方，
 * 且有速率限制。改打自家 `/api/link-preview`（Rust 端抓 OG meta + SQLite 快取）。
 *
 * 兩種呈現：
 *  - 有 og:image → 圖片卡
 *  - 沒有 → 降級卡（favicon + 站名 + 標題 + 描述）
 * 兩者高度一致，避免載入完成時卡片尺寸跳動。
 */

export interface LinkPreviewData {
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  favicon: string | null;
}

// enabled 由呼叫端控制 → 只有真的 hover 才發請求；同一連結全站共用快取。
export const linkPreviewQueryOptions = (url: string) =>
  queryOptions({
    queryKey: ['link-preview', url],
    queryFn: async (): Promise<LinkPreviewData> => {
      const res = await fetch(apiUrl(`/api/link-preview?url=${encodeURIComponent(url)}`));
      if (!res.ok) throw new Error(`GET /api/link-preview ${res.status}`);
      return (await res.json()) as LinkPreviewData;
    },
    staleTime: 30 * 60 * 1000, // 後端本身有 7 天快取，前端半小時內不重打
    retry: false,
  });

const HOVER_OPEN_DELAY = 320; // 滑過就跳卡片很吵 → 停留一下才開
const HOVER_CLOSE_DELAY = 140; // 讓滑鼠有時間從連結移進卡片，不會一離開連結就關
const CARD_W = 300;
const CARD_H = 300; // 估高（圖 158 + 文字區）——只用來決定要不要翻到上方
const GAP = 12;

export function LinkHoverPreview({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const { data, isPending } = useQuery({ ...linkPreviewQueryOptions(href), enabled: open });

  const openSoon = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 位置一律用 left/top 算好——不要用 transform 定位：framer-motion 的 animate（y/scale）
      // 也會寫 transform，會把 translateX(-50%) 覆蓋掉 → 卡片偏到游標底下、蓋住文字，
      // 還會因為蓋住連結而立刻觸發 mouseleave（= 使用者說的「有時候跑不出來」）。
      const spaceBelow = window.innerHeight - r.bottom;
      const above = spaceBelow < CARD_H + GAP && r.top > CARD_H + GAP;
      const x = Math.min(
        Math.max(r.left + r.width / 2 - CARD_W / 2, GAP),
        window.innerWidth - CARD_W - GAP,
      );
      setPos({ x, y: above ? r.top - CARD_H - GAP : r.bottom + GAP, above });
      setOpen(true);
    }, HOVER_OPEN_DELAY);
  }, []);

  // 延遲關閉：滑鼠從連結移到卡片之間有空隙，立刻關會讓卡片永遠碰不到
  const closeSoon = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }, []);

  const cancelClose = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const isInternal = /^\/(blog|thinking)\//.test(href) || href.includes('koimsurai.com');

  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        className={className}
        target={isInternal ? undefined : '_blank'}
        rel={isInternal ? undefined : 'noopener noreferrer'}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onFocus={openSoon}
        onBlur={closeSoon}
      >
        {children}
      </a>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              className="lhp-card"
              initial={{ opacity: 0, y: pos.above ? 6 : -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.above ? 6 : -6, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              /* 只給 left/top —— transform 保留給 framer（見 openSoon 的註解） */
              style={{ left: pos.x, top: pos.y }}
              onMouseEnter={cancelClose}
              onMouseLeave={closeSoon}
            >
              {isPending ? (
                <div className="lhp-skel" />
              ) : data?.image ? (
                <img className="lhp-img" src={data.image} alt="" loading="lazy" />
              ) : (
                /* 降級卡：沒有 og:image 時用 favicon + 站名撐版面，高度與圖片卡一致 */
                <div className="lhp-fallback">
                  {data?.favicon && <img className="lhp-favicon" src={data.favicon} alt="" loading="lazy" />}
                  <span className="lhp-site">{data?.site_name ?? new URL(href, 'https://koimsurai.com').hostname}</span>
                </div>
              )}
              <div className="lhp-body">
                <div className="lhp-title">{data?.title ?? href}</div>
                {data?.description && <div className="lhp-desc">{data.description}</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

export default LinkHoverPreview;
