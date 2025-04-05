import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom'; // 導入 Link
import './PhotoGallery.css'; // 引入對應的 CSS 檔案

// 使用 Vite 的 import.meta.glob 動態導入圖片，優先載入 webp
const imageModules = import.meta.glob('../assets/Portfolio/*.{webp,jpg,jpeg,png,gif,svg}', { eager: true });

// 將導入的模組轉換為圖片資訊陣列
const portfolioImages = Object.entries(imageModules).map(([path, module], index) => {
  const fileName = path.split('/').pop().split('.')[0];
  let displayDate = '日期'; // 預設值
  let displayYear = '年份'; // 預設值

  // 嘗試從檔名開頭提取 YYYYMMDD
  const dateMatch = fileName.match(/^(\d{4})(\d{2})(\d{2})/);
  if (dateMatch) {
    displayYear = dateMatch[1]; // YYYY
    const month = dateMatch[2]; // MM
    const day = dateMatch[3];   // DD
    displayDate = `${month}/${day}`; // MM/DD
  } else {
    // 如果檔名不是日期開頭，可以保留原始檔名作為標題
  }

  // 如果檔名是日期開頭，標題可以設為更有意義的文字或留空
  const title = dateMatch ? `攝影作品 ${index + 1}` : fileName;


  return {
    id: index,
    title: title, // 更新標題邏輯
    displayDate: displayDate, // MM/DD 格式
    displayYear: displayYear, // YYYY 格式
    imageUrl: module.default
  };
});

function PhotoGallery() {
  return (
    <section id="photo-gallery" className="photo-gallery-section">
      {/* 添加返回按鈕 */}
      <Link to="/" className="back-button">
        &larr; 返回主頁
      </Link>

      {/* 可以選擇性地為子頁面添加標題 */}
      <motion.div
        className="photo-gallery-header"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }} // 直接執行動畫，因為是頁面載入
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        <h2>攝影作品集錦</h2>
        <p>Personal Photography Collection</p>
      </motion.div>

      {/* 使用之前設計的 Grid 佈局 */}
      <div className="photo-grid"> {/* 使用新的 class name */}
        {portfolioImages.map((item, index) => (
          <motion.div
            key={item.id}
            className="photo-grid-item" // 使用新的 class name
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }} // 直接執行動畫
            transition={{ duration: 0.6, delay: index * 0.05 }} // 稍微調整延遲
          >
            {/* 根據索引決定圖片和文字的順序 */}
            {index % 2 === 0 ? (
              <>
                <div className="photo-image-block"> {/* 使用新的 class name */}
                  <img src={item.imageUrl} alt={item.title} />
                </div>
                <div className="photo-text-block"> {/* 使用新的 class name */}
                  {/* 顯示 MM/DD */}
                  <p className="photo-date">{item.displayDate}</p>
                  {/* 顯示 YYYY */}
                  <p className="photo-year">{item.displayYear}</p>
                  {/* 可以選擇是否仍要顯示標題 */}
                  {/* <h3>{item.title}</h3> */}
                </div>
              </>
            ) : (
              <>
                <div className="photo-text-block"> {/* 使用新的 class name */}
                   {/* 顯示 MM/DD */}
                  <p className="photo-date">{item.displayDate}</p>
                  {/* 顯示 YYYY */}
                  <p className="photo-year">{item.displayYear}</p>
                  {/* 可以選擇是否仍要顯示標題 */}
                  {/* <h3>{item.title}</h3> */}
                </div>
                <div className="photo-image-block"> {/* 使用新的 class name */}
                  <img src={item.imageUrl} alt={item.title} />
                </div>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* 新增 Instagram 連結 */}
      <div className="instagram-link-container">
        <a
          href="https://www.instagram.com/koimsurai.23/?hl=zh-tw"
          target="_blank"
          rel="noopener noreferrer"
          className="instagram-link"
        >
          想看更多請點我
        </a>
      </div>
    </section>
  );
}

export default PhotoGallery;
