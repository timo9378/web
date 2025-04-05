import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom'; // 導入 Link 元件
import photoMainImage from '../assets/Photo-main.webp'; // 導入攝影集封面圖片 (更新為 webp)
import voltiCarTitleImage from '../assets/VoltiCar_title.png'; // 導入 VoltiCar 專案圖片
// 移除影片導入，因為它在 public 資料夾中
import './Portfolio.css'; // 引入對應的 CSS 檔案

// 恢復為之前的假資料
const portfolioItems = [
  {
    id: 1,
    category: 'App 開發 (進行中)',
    title: 'VoltiCar - 碳權電動車 App',
    description: '開發一款結合碳權概念、電動車充電資訊與遊戲化元素的 App。目標是鼓勵綠色能源行動，提供便捷充電體驗與趣味互動。目前專案正在開發中 (In Progress)，已完成後端架構設計與核心 API 開發。',
    imageUrl: voltiCarTitleImage, // 使用導入的 VoltiCar 圖片
    link: '#' // 暫無連結，或可放 GitHub Repo (若有)
  },
  {
    id: 2,
    category: '網頁開發',
    title: '個人形象網站 (本站)',
    description: '使用 React、Vite 和 CSS 打造的個人作品集網站，展示我的技能、經歷與作品。運用 Framer Motion 製作動態效果，並以 tsparticles 實現互動式背景。',
    videoUrl: '/videos/Web_video.mkv', // 直接使用 public 資料夾中的路徑
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
            <div className="portfolio-media-container"> {/* 更新 class name 以反映內容 */}
              {item.videoUrl ? (
                <video src={item.videoUrl} className="portfolio-video" controls autoPlay muted loop playsInline /> // 添加 video 標籤
              ) : (
                <img src={item.imageUrl} alt={item.title} className="portfolio-image" />
              )}
            </div>
            <div className="portfolio-content"> {/* 使用舊的 class name */}
              <span className="portfolio-category">{item.category}</span> {/* 使用舊的 class name */}
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {/* 修正條件渲染語法，並為 id: 1 添加特殊處理 */}
              {item.id === 1 ? (
                <span className="portfolio-link disabled-link">開發中...</span> // 使用 span 並添加 disabled 樣式
              ) : (
                item.link && (
                  item.link.startsWith('/') ? (
                    <Link to={item.link} className="portfolio-link">
                      {/* 根據 ID 顯示不同文字，保持攝影集連結文字 */}
                      {item.id === 3 ? '查看詳情' : '查看詳情'}
                    </Link>
                  ) : (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="portfolio-link">
                      {item.id === 2 ? '查看原始碼' : '查看詳情'}
                    </a>
                  )
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
