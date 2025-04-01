import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './RandomComets.css'; // 導入新的 CSS

const getRandomValue = (min, max) => Math.random() * (max - min) + min;

// 創建彗星數據 (基於流星修改)
const createComet = () => {
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

const RandomComets = ({ count = 2 }) => { // 彗星數量減少為 2
  const [comets, setComets] = useState(() =>
    Array.from({ length: count }, createComet)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setComets(prevComets => {
        const newComets = [...prevComets];
        const randomIndex = Math.floor(Math.random() * newComets.length);
        newComets[randomIndex] = createComet();
        // 確保新彗星的 delay
        newComets[randomIndex].delay = getRandomValue(5, 20); // 更長的延遲
        return newComets;
      });
    }, 12000); // 每 12 秒嘗試更新一顆 (頻率更低)

    return () => clearInterval(interval);
  }, [count]);

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
              left: comet.startX, // Set initial position using left/top
              top: comet.startY,
              rotate: `${comet.rotate}deg`, // Apply initial rotation via style
              scale: comet.sizeScale, // Apply initial scale via style
            }}
            initial={{
              opacity: 0,
              x: 0, // Initial relative position is 0
              y: 0,
            }}
            animate={{
              x: comet.endX, // Animate relative position using x/y
              y: comet.endY,
              opacity: [0, 0.8, 0.8, 0], // Keep opacity animation
            }}
            transition={{
              delay: comet.delay,
              duration: comet.duration,
              x: { duration: comet.duration, ease: 'linear' }, // Animate x linearly
              y: { duration: comet.duration, ease: 'linear' }, // Animate y linearly
              opacity: { duration: comet.duration, times: [0, 0.15, 0.9, 1] } // Keep opacity timing
            }}
            exit={{ opacity: 0, x: comet.endX, y: comet.endY }} // Ensure exit animation starts from the end state if interrupted
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RandomComets;
