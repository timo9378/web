// 自訂右鍵選單（全站）。按住 Shift 右鍵 → 讓瀏覽器原生選單出來（不攔截）。
// 右鍵在連結上 → 多出「開新分頁 / 複製連結」；隨處都有「隨機文章 / 回到頂部」。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUp, Copy, ExternalLink, RotateCw, Shuffle } from 'lucide-react';
import './ContextMenu.css';

interface MenuState {
  x: number;
  y: number;
  href: string | null;
}

export default function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // 右鍵：Shift 放行原生；否則攔截、記錄座標與（若有）連結
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.shiftKey) return;
      e.preventDefault();
      const el = e.target instanceof Element ? e.target.closest('a[href]') : null;
      setMenu({ x: e.clientX, y: e.clientY, href: el?.getAttribute('href') ?? null });
    };
    document.addEventListener('contextmenu', onContext);
    return () => document.removeEventListener('contextmenu', onContext);
  }, []);

  // 開著時：點外面 / Esc / 捲動 → 關
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  // 夾到視窗內（量測後校正位置）
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(menu.x, window.innerWidth - r.width - pad);
    const top = Math.min(menu.y, window.innerHeight - r.height - pad);
    // 量測選單尺寸後才能夾進視窗 → 這裡的 setState 是必要的（layout effect、paint 前）
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top) });
  }, [menu]);

  const run = useCallback((fn: () => void) => {
    fn();
    setMenu(null);
  }, []);

  const goRandom = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch('/api/posts?limit=100');
        const data: unknown = await res.json();
        const list = Array.isArray(data) ? data : (data as { posts?: unknown[] }).posts;
        const ids = (Array.isArray(list) ? list : [])
          .map((p) => (p as { id?: number }).id)
          .filter((v): v is number => typeof v === 'number');
        if (!ids.length) return;
        const id = ids[Math.floor(Math.random() * ids.length)];
        void navigate({ to: '/blog/$id', params: { id: String(id) } });
      } catch {
        /* 靜默失敗 */
      }
    })();
  }, [navigate]);

  if (!menu) return null;
  const { href } = menu;

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      // role="menu" 是互動角色，必須能被聚焦（interactive-supports-focus）。
      // -1：不進 Tab 序列，但選單開啟時可以用程式把焦點送進來。
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-nav">
        <button
          type="button"
          className="ctx-nav-btn"
          title="上一頁"
          aria-label="上一頁"
          onClick={() => run(() => history.back())}
        >
          <ArrowLeft className="ctx-icon" aria-hidden />
        </button>
        <button
          type="button"
          className="ctx-nav-btn"
          title="下一頁"
          aria-label="下一頁"
          onClick={() => run(() => history.forward())}
        >
          <ArrowRight className="ctx-icon" aria-hidden />
        </button>
        <button
          type="button"
          className="ctx-nav-btn"
          title="重新整理"
          aria-label="重新整理"
          onClick={() => run(() => location.reload())}
        >
          <RotateCw className="ctx-icon" aria-hidden />
        </button>
      </div>
      <div className="ctx-divider" />
      {href ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => run(() => window.open(href, '_blank', 'noopener,noreferrer'))}
          >
            <ExternalLink className="ctx-icon" aria-hidden />
            在新分頁開啟連結
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => run(() => void navigator.clipboard.writeText(new URL(href, location.href).href))}
          >
            <Copy className="ctx-icon" aria-hidden />
            複製連結網址
          </button>
          <div className="ctx-divider" />
        </>
      ) : null}
      <button type="button" role="menuitem" className="ctx-item" onClick={() => run(goRandom)}>
        <Shuffle className="ctx-icon" aria-hidden />
        隨機文章
      </button>
      <button
        type="button"
        role="menuitem"
        className="ctx-item"
        onClick={() => run(() => window.scrollTo({ top: 0, behavior: 'smooth' }))}
      >
        <ArrowUp className="ctx-icon" aria-hidden />
        回到頂部
      </button>
      <div className="ctx-hint">按住 Shift 右鍵可叫出瀏覽器原生選單</div>
    </div>
  );
}
