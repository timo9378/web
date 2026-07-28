import { useEffect, useRef } from 'react';
import './MeteorShower.css';
import { usePageVisibility } from '../contexts/pageVisibility';

const MeteorShower = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isVisible } = usePageVisibility();

  useEffect(() => {
    // 如果頁面不可見，完全不啟動流星雨
    if (!isVisible) {
      console.log('MeteorShower: 已暫停 (頁面不可見)');
      return;
    }

    // 在 effect 執行當下抓住節點，cleanup 用這個而不是再讀 ref（見下方 cleanup 註解）
    const container = containerRef.current;

    // 追蹤所有 setTimeout，unmount / isVisible 變動時一併清掉，
    // 否則流星移除與初始排程的計時器會殘留到 effect 重跑之後。
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    const laterFn = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timeouts.delete(id);
        fn();
      }, ms);
      timeouts.add(id);
    };

    const createMeteor = () => {
      if (!containerRef.current || !isVisible) return;

      const meteor = document.createElement('div');
      meteor.className = 'meteor';

      // 隨機位置和大小
      const startX = Math.random() * window.innerWidth;
      const startY = -50;
      const size = Math.random() * 3 + 1;
      const duration = Math.random() * 3 + 2;
      const delay = Math.random() * 2;

      meteor.style.left = `${startX}px`;
      meteor.style.top = `${startY}px`;
      meteor.style.width = `${size}px`;
      meteor.style.height = `${size}px`;
      meteor.style.animationDuration = `${duration}s`;
      meteor.style.animationDelay = `${delay}s`;

      containerRef.current.appendChild(meteor);

      // 動畫結束後移除元素
      laterFn(() => {
        if (meteor.parentNode) {
          meteor.parentNode.removeChild(meteor);
        }
      }, (duration + delay) * 1000);
    };

    // 減少流星創建頻率以提升效能
    const interval = setInterval(() => {
      if (isVisible) {
        createMeteor();
      }
    }, 5000); // 從 3 秒增加到 5 秒

    // 減少初始流星數量
    for (let i = 0; i < 2; i++) {
      laterFn(() => {
        if (isVisible) {
          createMeteor();
        }
      }, i * 2000); // 間隔增加到 2 秒
    }

    return () => {
      clearInterval(interval);
      timeouts.forEach((id) => { clearTimeout(id); });
      timeouts.clear();
      // 清理所有現存的流星。用 effect 執行當下抓到的 container，不是 cleanup 當下的
      // containerRef.current —— 後者在 cleanup 時可能已經指向別的節點或變成 null，
      // 那樣就會漏清這一輪真正產生的流星。
      if (container) {
        container.querySelectorAll('.meteor').forEach(meteor => { meteor.remove(); });
      }
    };
  }, [isVisible]);

  return <div ref={containerRef} className="meteor-shower-container"></div>;
};

export default MeteorShower;
