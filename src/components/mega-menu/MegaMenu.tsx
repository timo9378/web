import React, { useRef, useCallback, createContext, use, useState, type ReactNode, type CSSProperties } from 'react';
import { LocaleLink } from '../../locale-link';
import { motion, AnimatePresence } from 'framer-motion';
import { FaChevronDown } from 'react-icons/fa';
import './mega-menu.css';

/**
 * MegaMenu — hover-triggered 2-column rich panel，靈感來自 Stripe / Linear
 *
 * 結構：
 *   <MegaMenuRoot>          // 管理「目前哪個 menu 開著」，確保最多 1 個同時打開
 *     <MegaMenu id="home" label="首頁" icon={...}>
 *       <MegaMenuPanel>
 *         <MegaMenuColumn>...</MegaMenuColumn>
 *         <MegaMenuColumn>...</MegaMenuColumn>
 *       </MegaMenuPanel>
 *     </MegaMenu>
 *   </MegaMenuRoot>
 */

const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 220;

interface MegaMenuContextValue {
  openId: string | null;
  setOpenId: React.Dispatch<React.SetStateAction<string | null>>;
}

const MegaMenuContext = createContext<MegaMenuContextValue | null>(null);

export function MegaMenuRoot({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <MegaMenuContext value={{ openId, setOpenId }}>
      <ul className={`mega-menu-bar ${className}`}>{children}</ul>
    </MegaMenuContext>
  );
}

interface MegaMenuProps {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  to?: string | null;
  children?: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}

export function MegaMenu({ id, label, icon, active = false, to = null, children, onClick }: MegaMenuProps) {
  const ctx = use(MegaMenuContext);
  if (!ctx) throw new Error('<MegaMenu> must be inside <MegaMenuRoot>');
  const { openId, setOpenId } = ctx;
  const isOpen = openId === id;
  // trigger hover 狀態：傳給 icon 元素驅動動畫（icon 需接受 hover prop）
  const [hovering, setHovering] = useState(false);

  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAll = useCallback(() => {
    if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearAll();
    if (!children) return;
    enterTimerRef.current = setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
  }, [id, children, clearAll, setOpenId]);

  const handleMouseLeave = useCallback(() => {
    clearAll();
    leaveTimerRef.current = setTimeout(() => {
      setOpenId((cur) => (cur === id ? null : cur));
    }, CLOSE_DELAY_MS);
  }, [id, clearAll, setOpenId]);

  const handlePanelMouseEnter = useCallback(() => { clearAll(); }, [clearAll]);
  const handlePanelMouseLeave = useCallback(() => {
    clearAll();
    leaveTimerRef.current = setTimeout(() => {
      setOpenId((cur) => (cur === id ? null : cur));
    }, CLOSE_DELAY_MS);
  }, [id, clearAll, setOpenId]);

  // 點擊行為：
  //  - 有 `to` → 是個 Link，正常 navigate，順手關 panel；onClick 仍可呼叫
  //  - 沒 `to` → 純 trigger，點擊切換 panel 開關
  const handleTriggerClick = useCallback((e: React.MouseEvent) => {
    if (to) {
      setOpenId(null);
    } else if (isOpen) {
      setOpenId(null);
    } else if (children) {
      setOpenId(id);
    }
    if (onClick) onClick(e);
  }, [to, isOpen, children, id, onClick, setOpenId]);

  const triggerClass = `mega-menu-trigger ${active ? 'mega-menu-trigger--active' : ''} ${isOpen ? 'mega-menu-trigger--open' : ''}`;

  const triggerInner = (
    <>
      {icon && (
        <span className="mega-menu-trigger-icon">
          {/* clone 注入 hover：icon 元件（如 TriggerAnimIcon）可據此播放動畫 */}
          {React.isValidElement<{ hover?: boolean }>(icon) ? React.cloneElement(icon, { hover: hovering || isOpen }) : icon}
        </span>
      )}
      <span className="mega-menu-trigger-label">{label}</span>
      {children && <FaChevronDown className={`mega-menu-trigger-chev ${isOpen ? 'is-open' : ''}`} />}
    </>
  );

  return (
    <li
      className="mega-menu-item"
      onMouseEnter={() => { setHovering(true); handleMouseEnter(); }}
      onMouseLeave={() => { setHovering(false); handleMouseLeave(); }}
    >
      {to ? (
        <LocaleLink to={to} className={triggerClass} onClick={handleTriggerClick}>
          {triggerInner}
        </LocaleLink>
      ) : (
        <button type="button" className={triggerClass} onClick={handleTriggerClick}>
          {triggerInner}
        </button>
      )}
      {/* 外層 div 純粹做位置（absolute + 置中對齊 trigger），不被 framer-motion 的 transform 覆蓋；
          內層 motion.div 只負責 opacity / y / scale 動畫 */}
      <div className="mega-menu-panel-anchor">
        <AnimatePresence>
          {isOpen && children && (
            <motion.div
              className="mega-menu-panel-animator"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              onMouseEnter={handlePanelMouseEnter}
              onMouseLeave={handlePanelMouseLeave}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

export function MegaMenuPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mega-menu-panel ${className}`}>{children}</div>;
}

interface MegaMenuColumnProps {
  title?: ReactNode;
  accent?: boolean;
  children: ReactNode;
  className?: string;
  span?: number;
}

export function MegaMenuColumn({ title, accent = false, children, className = '', span = 1 }: MegaMenuColumnProps) {
  return (
    <div className={`mega-menu-column ${accent ? 'mega-menu-column--accent' : ''} ${className}`} style={{ '--span': span } as CSSProperties}>
      {title && <div className="mega-menu-column-title">{title}</div>}
      <div className="mega-menu-column-body">{children}</div>
    </div>
  );
}
