import React from 'react';
import { motion } from 'framer-motion'; // 導入 motion
import './Expertise.css'; // 引入對應的 CSS 檔案

function Expertise() {
  // 根據履歷內容
  const skills = {
    'Front-end': ['Dart', 'Figma'], // 履歷圖片顯示
    'Back-end': ['Java', 'Python'], // 履歷圖片顯示
    'Others': ['Linux', 'Github', 'Docker', 'MongoDB'] // 履歷圖片顯示
  };

  return (
    <section // 恢復為普通 section
      id="expertise"
      className="expertise-section"
    >
      <h2>專業技能</h2> {/* Section 標題 */}
      <motion.div // 將動畫應用於 skills-container
        className="skills-container"
        initial={{ opacity: 0, y: 50 }} // 初始狀態
        whileInView={{ opacity: 1, y: 0 }} // 進入視圖時的狀態
        transition={{ duration: 0.8, ease: "easeOut" }} // 動畫效果
        viewport={{ once: true }} // 動畫只觸發一次
      >
        {Object.entries(skills).map(([category, items]) => (
          <div key={category} className="skill-category">
            <h3>{category}</h3>
            <ul>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </motion.div>
    </section> // 結束 section
  );
}

export default Expertise;
