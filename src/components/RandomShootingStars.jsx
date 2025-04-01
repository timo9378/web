import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './RandomShootingStars.css'; // 導入 CSS

const getRandomValue = (min, max) => Math.random() * (max - min) + min;

// 創建流星數據
const createShootingStar = () => {
  const duration = getRandomValue(2.0, 5.0); // 動畫持續時間 (增加範圍)
  const angle = getRandomValue(0, 360); // 隨機角度 (0-360 度)
  const distance = getRandomValue(300, 700); // 飛行距離 (px) (增加範圍)
  const startX = getRandomValue(-10, 110); // 起始 X 位置 (% of width)
  const startY = getRandomValue(-10, 110); // 起始 Y 位置 (% of height)

  // 根據角度和距離計算結束位置的相對偏移
  const endXOffset = distance * Math.cos(angle * Math.PI / 180);
  const endYOffset = distance * Math.sin(angle * Math.PI / 180);

  return {
    id: Math.random(),
    startX: `${startX}%`,
    startY: `${startY}%`,
    // 相對結束位置，framer-motion 會處理從初始位置的動畫
    endX: endXOffset,
    endY: endYOffset,
    duration: duration,
    delay: getRandomValue(0, 6), // 延遲出現
    rotate: angle, // 直接使用飛行角度旋轉元素
    sizeScale: getRandomValue(0.6, 1.4) // 新增整體縮放比例
  };
};

const RandomShootingStars = ({ count = 10 }) => {
  const [stars, setStars] = useState(() =>
    Array.from({ length: count }, createShootingStar)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setStars(prevStars => {
        const newStars = [...prevStars];
        const randomIndex = Math.floor(Math.random() * newStars.length);
        newStars[randomIndex] = createShootingStar();
        // 確保新星的 delay 不會太小
        newStars[randomIndex].delay = getRandomValue(0.5, 6);
        return newStars;
      });
    }, 3000); // 每 3 秒嘗試更新一顆

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
        zIndex: 4,
        overflow: 'hidden',
      }}> {/* z-index: 4 */}
        <AnimatePresence>
          {stars.map(star => (
          <motion.div
            key={star.id}
            className="shooting-star" // Add a class for potential CSS targeting
            style={{
              position: 'absolute',
              width: '180px',
              height: '1.5px',
              background: 'linear-gradient(to right, rgba(238, 130, 238, 0), rgba(180, 140, 255, 0.8))',
              borderRadius: '1px',
              // Consider moving animation to CSS if preferred
              // animation: 'shooting-star-glow 1.5s ease-in-out infinite',
              transformOrigin: 'left center',
              left: star.startX, // Set initial position
              top: star.startY,
              rotate: `${star.rotate}deg`, // Apply initial rotation
              scale: star.sizeScale, // Apply initial scale
            }}
            initial={{
              opacity: 0,
              x: 0, // Initial relative position
              y: 0,
            }}
            animate={{
              x: star.endX, // Animate relative position
              y: star.endY,
              opacity: [0, 1, 1, 0], // Fade in -> stay -> fade out
            }}
            transition={{
              delay: star.delay,
              duration: star.duration,
              x: { duration: star.duration, ease: 'linear' }, // Linear movement for x
              y: { duration: star.duration, ease: 'linear' }, // Linear movement for y
              opacity: { duration: star.duration, times: [0, 0.3, 0.95, 1] } // Opacity timing
            }}
            exit={{ opacity: 0, x: star.endX, y: star.endY }} // Exit from end state
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RandomShootingStars;
