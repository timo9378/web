import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import './ForegroundStars.css';

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  brightness: number;
  parallaxFactor: number;
}

interface ForegroundStarsProps {
  count?: number;
}

const ForegroundStars = ({ count = 50 }: ForegroundStarsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 星星位置是純衍生值（只看 count），render 期算掉即可，不必先繪一次空畫面再由 effect 補繪。
  // Math.random 在 render 期通常會造成 hydration mismatch，這裡安全：本元件掛在
  // AppShell 的 <ClientOnly> → SpaceBackdropShell → DomSpaceEffects 底下，從不 SSR。
  const stars = useMemo<Star[]>(
    () => Array.from({ length: count }, (_, id) => ({
      id,
      x: Math.random() * 100, // %
      y: Math.random() * 100, // %
      size: Math.random() * 2.5 + 1.5, // 1.5px to 4px
      brightness: Math.random() * 0.5 + 0.5, // 0.5 to 1.0
      parallaxFactor: Math.random() * 0.03 + 0.01, // 0.01 to 0.04 (adjust for sensitivity)
    })),
    [count],
  );

  // 處理滑鼠移動以實現視差效果
  useEffect(() => {
    // 只把「滑鼠相對中心的位移」寫進容器的 CSS 變數，實際位移交給 CSS 逐顆星去算。
    // 原本每次 mousemove 都 setStars(重建整個陣列) → React 重繪全部星星；
    // 純裝飾效果不值得這個代價，而且滑鼠事件本來就密集。
    const handleMouseMove = (event: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      // 計算滑鼠相對於容器中心的位置 (-0.5 to 0.5)
      el.style.setProperty('--mx', String((event.clientX / el.clientWidth) - 0.5));
      el.style.setProperty('--my', String((event.clientY / el.clientHeight) - 0.5));
    };

    const currentRef = containerRef.current; // Capture ref value
    if (currentRef) {
        // Attach listener to the container itself or window
        window.addEventListener('mousemove', handleMouseMove);
    }


    return () => {
      if (currentRef) {
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <div className="foreground-stars-container" ref={containerRef}>
      {stars.map(star => (
        <div
          key={star.id}
          className="foreground-star"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.brightness,
            // 視差幅度交給 CSS：transform 由 --mx/--my（容器層）× --pf（本顆）算出
            '--pf': star.parallaxFactor,
          } as CSSProperties}
        />
      ))}
    </div>
  );
};

export default ForegroundStars;
