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

const RandomShootingStars = ({ count = 5 }) => { // Reduce default shooting star count to 5
  const [stars, setStars] = useState(() =>
    Array.from({ length: count }, createShootingStar)
  );

  // Remove useEffect with setInterval

  const handleAnimationComplete = (id) => {
    setStars(prevStars =>
      prevStars.map(star =>
        star.id === id ? createShootingStar() : star
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
              // Revert to using left/top for initial position
              left: star.startX,
              top: star.startY,
              rotate: `${star.rotate}deg`, // Apply initial rotation
              scale: star.sizeScale, // Apply initial scale
            }}
            initial={{
              opacity: 0,
              x: 0, // Initial relative transform offset
              y: 0,
            }}
            animate={{
              x: star.endX, // Animate relative transform offset
              y: star.endY,
              opacity: [0, 1, 1, 0], // Restore full opacity cycle
            }}
            transition={{
              delay: star.delay,
              duration: star.duration, // Keep one duration
              x: { duration: star.duration, ease: 'linear' }, // Keep one x transition
              y: { duration: star.duration, ease: 'linear' },
              opacity: { duration: star.duration, times: [0, 0.3, 0.95, 1] } // Restore times array
            }}
            onAnimationComplete={() => handleAnimationComplete(star.id)} // Trigger replacement on completion
            exit={{ opacity: 0 }} // Keep exit for AnimatePresence handling if needed
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RandomShootingStars;
