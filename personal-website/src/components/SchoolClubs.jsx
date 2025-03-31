import React from 'react';
import { motion } from 'framer-motion';
import './SchoolClubs.css'; // 引入新的 CSS 檔案

// 社團經歷資料
const clubs = [
  { name: '111屆資管系學會', role: '會長' },
  { name: '112屆絃韻吉他社', role: '文書' },
  { name: '第一屆台科攝影社', role: '教學' }
];

function SchoolClubs() {
  return (
    // 將 section id 和 className 更新
    <section id="school-clubs" className="school-clubs-section">
      {/* 更新標題 */}
      <h2>社團經歷</h2>
      {/* 使用 motion.div 包裹社團列表容器，應用動畫 */}
      <motion.div
        className="clubs-container" // 新的容器 class
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        {/* 遍歷社團資料並顯示 */}
        {clubs.map((club, index) => (
          <div key={index} className="club-item"> {/* 新的項目 class */}
            <h3>{club.name}</h3>
            <p>{club.role}</p>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

export default SchoolClubs;
