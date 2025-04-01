import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom'; // 導入 Link 元件
import photoMainImage from '../assets/Photo-main.jpg'; // 導入攝影集封面圖片
import './Portfolio.css'; // 引入對應的 CSS 檔案

// 恢復為之前的假資料
const portfolioItems = [
  {
    id: 1,
    category: 'UI/UX 設計',
    title: '專案標題一',
    description: '這裡是專案的簡短描述，說明專案的目標和特色。',
    imageUrl: 'https://via.placeholder.com/600x400/cccccc/888888?text=Project+Image+1', // 佔位圖片
    link: '#' // 專案連結 (可選)
  },
  {
    id: 2,
    category: '網頁開發',
    title: '個人形象網站 (本站)',
    description: '使用 React、Vite 和 CSS 打造的個人作品集網站，展示我的技能、經歷與作品。運用 Framer Motion 製作動態效果，並以 tsparticles 實現互動式背景。',
    imageUrl: 'https://via.placeholder.com/600x400/cccccc/888888?text=Project+Image+2', // 佔位圖片 (可替換)
    link: 'https://github.com/timo9378/web' // GitHub 連結
  },
  {
    id: 3,
    category: '攝影作品集', // 修改分類
    title: '個人攝影集錦', // 修改標題
    description: '包含多張個人攝影作品，點擊查看詳情。', // 修改描述
    imageUrl: photoMainImage, // 使用導入的圖片
    link: '/photos' // 將連結指向新的照片頁面
  }
];

function Portfolio() {
  return (
    <section id="portfolio" className="portfolio-section">
      <motion.div
        className="portfolio-header"
        initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
        whileInView={{ opacity: 1, scale: 1 }} // 改為放大
        transition={{ duration: 0.6, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        <h2>作品集展示</h2>
        <p>Part of the portfolio display</p>
      </motion.div>

      {/* 恢復為之前的 Grid 佈局 (用於卡片) */}
      <div className="portfolio-grid">
        {portfolioItems.map((item, index) => (
          <motion.div
            key={item.id}
            className="portfolio-item" // 使用舊的 class name
            initial={{ opacity: 0, scale: 0.8 }} // 移除 y 和 rotateY，調整 scale
            whileInView={{ opacity: 1, scale: 1 }} // 移除 y 和 rotateY
            transition={{ duration: 0.6, delay: index * 0.15, ease: "easeOut" }} // 稍微調整 duration 和 delay
            viewport={{ once: true }}
          >
            <div className="portfolio-image-container"> {/* 使用舊的 class name */}
              <img src={item.imageUrl} alt={item.title} className="portfolio-image" /> {/* 使用舊的 class name */}
            </div>
            <div className="portfolio-content"> {/* 使用舊的 class name */}
              <span className="portfolio-category">{item.category}</span> {/* 使用舊的 class name */}
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {/* 修正條件渲染語法 */}
              {item.link && (
                item.link.startsWith('/') ? (
                  <Link to={item.link} className="portfolio-link"> {/* 使用舊的 class name */}
                    查看詳情
                  </Link>
                ) : (
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="portfolio-link"> {/* 外部連結仍用 a */}
                    {item.id === 2 ? '查看原始碼' : '查看詳情'} {/* 根據 ID 顯示不同文字 */}
                  </a>
                )
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default Portfolio;
