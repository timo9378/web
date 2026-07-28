import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './RandomComets.css'; // 引入彗星的 CSS
import { usePageVisibility } from '../contexts/pageVisibility';

const getRandomValue = (min: number, max: number) => Math.random() * (max - min) + min;

interface Comet {
  id: number;
  startX: string;
  startY: string;
  endX: number;
  endY: number;
  duration: number;
  delay: number;
  rotate: number;
  sizeScale: number;
}

// 創建彗星數據 (基於流星修改)
const createComet = (): Comet => {
  const duration = getRandomValue(8.0, 15.0); // 動畫持續時間 (顯著增加，更慢)
  const angle = getRandomValue(0, 360); // 隨機角度
  const distance = getRandomValue(600, 1200); // 飛行距離 (顯著增加)
  const startX = getRandomValue(-15, 115); // 起始 X 位置 (% of width, 範圍稍大)
  const startY = getRandomValue(-15, 115); // 起始 Y 位置 (% of height, 範圍稍大)

  // 根據角度和距離計算結束位置的相對偏移
  const endXOffset = distance * Math.cos(angle * Math.PI / 180);
  const endYOffset = distance * Math.sin(angle * Math.PI / 180);

  return {
    id: Math.random(),
    startX: `${startX}%`,
    startY: `${startY}%`,
    endX: endXOffset,
    endY: endYOffset,
    duration: duration,
    delay: getRandomValue(2, 15), // 延遲出現 (範圍更大)
    rotate: angle,
    sizeScale: getRandomValue(0.8, 1.8) // 整體縮放比例 (可以更大)
  };
};

interface RandomCometsProps {
  count?: number;
}

const RandomComets = ({ count = 1 }: RandomCometsProps) => { // Reduce default comet count to 1
  const { isVisible } = usePageVisibility();
  const [comets, setComets] = useState<Comet[]>(() =>
    Array.from({ length: count }, createComet)
  );

  // Remove useEffect with setInterval

  const handleAnimationComplete = (id: number) => {
    setComets(prevComets =>
      prevComets.map(comet =>
        comet.id === id ? createComet() : comet
      )
    );
  };

   return (
     <div style={{
       position: 'fixed',
       top: 0,
       left: 0,
       width: '100%',
       height: '100%',
       pointerEvents: 'none',
        zIndex: 3, // 比流星低一層 (可調整)
        overflow: 'hidden',
      }}>
        <AnimatePresence>
          {comets.map(comet => (
          <motion.div
            key={comet.id}
            className="comet" // 使用 CSS class
            style={{
              position: 'absolute', // Ensure position is absolute
              transformOrigin: 'left center',
              left: comet.startX, // Revert to using left/top for initial position
              top: comet.startY,
              rotate: `${comet.rotate}deg`, // Apply initial rotation via style
              scale: comet.sizeScale, // Apply initial scale via style
            }}
            initial={{
              opacity: 0,
              x: 0, // Initial relative transform offset
              y: 0,
            }}
            animate={isVisible ? {
              x: comet.endX, // Animate relative transform offset
              y: comet.endY,
              opacity: [0, 0.8, 0.8, 0], // Restore full opacity cycle
            } : {}}
            transition={{
              delay: comet.delay,
              duration: isVisible ? comet.duration : 0,
              x: { duration: isVisible ? comet.duration : 0, ease: 'linear' },
              y: { duration: isVisible ? comet.duration : 0, ease: 'linear' },
              opacity: { duration: isVisible ? comet.duration : 0, times: [0, 0.15, 0.9, 1] } // Restore times array
            }}
            onAnimationComplete={() => { handleAnimationComplete(comet.id); }} // Trigger replacement on completion
            exit={{ opacity: 0 }} // Keep exit for AnimatePresence handling if needed
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RandomComets;
