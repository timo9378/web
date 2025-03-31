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
    title: '專案標題二',
    description: '另一個專案的描述，可以更詳細地介紹使用的技術或成果。',
    imageUrl: 'https://via.placeholder.com/600x400/cccccc/888888?text=Project+Image+2', // 佔位圖片
    link: '#'
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
        initial={{ opacity: 0, y: -30 }}
        whileInView={{ opacity: 1, y: 0 }}
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
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }} // 錯開動畫時間
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
                    查看詳情
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
