import React from 'react';
import { motion } from 'framer-motion';
import './TransitionAnimation.css'; // 引入 CSS 樣式

const TransitionAnimation = () => {
  // 動畫變體
  const starVariants = {
    hidden: {
      x: '-100%', // 從左邊螢幕外開始
      y: '-100%',
      opacity: 0,
    },
    visible: {
      x: '100%', // 移動到右邊螢幕外
      y: '100%',
      opacity: [0.5, 1, 0.5, 0], // 淡入再淡出
      transition: {
        duration: 1.5, // 動畫持續時間
        ease: 'linear', // 線性運動
        opacity: {
          times: [0, 0.2, 0.8, 1], // 控制透明度變化的時間點
          duration: 1.5
        }
      }
    }
  };

  return (
    <div className="transition-container">
      <motion.div
        className="shooting-star"
        variants={starVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.5 }} // 進入視圖一半時觸發一次
      />
    </div>
  );
};

export default TransitionAnimation;
