import React from 'react';
import { motion } from 'framer-motion'; // 導入 motion
import './Contact.css'; // 引入對應的 CSS 檔案

function Contact() {
  // 根據履歷內容
  const contactInfo = {
    phone: '0906503623',
    email: 'timo9378@gmail.com',
    website: 'www.reallygreatsite.com', // 履歷上的網址，可能需要更新
    address: '新北市永和區成功路一段60號5樓'
  };

  return (
    <section // 恢復為普通 section
      id="contact"
      className="contact-section"
    >
      <h2>聯絡資訊</h2>
      <motion.div // 將動畫應用於 contact-info-container
        className="contact-info-container"
        initial={{ opacity: 0, y: 50 }} // 初始狀態
        whileInView={{ opacity: 1, y: 0 }} // 進入視圖時的狀態
        transition={{ duration: 0.8, ease: "easeOut" }} // 動畫效果
        viewport={{ once: true }} // 動畫只觸發一次
      >
        <div className="contact-item">
          <span className="icon">📞</span> {/* 暫用 emoji 圖標 */}
          <a href={`tel:${contactInfo.phone}`}>{contactInfo.phone}</a>
        </div>
        <div className="contact-item">
          <span className="icon">✉️</span>
          <a href={`mailto:${contactInfo.email}`}>{contactInfo.email}</a>
        </div>
        <div className="contact-item">
          <span className="icon">🌐</span>
          {/* 確保網址包含協議 (http/https) 才能正確連結 */}
          <a href={`http://${contactInfo.website}`} target="_blank" rel="noopener noreferrer">{contactInfo.website}</a>
        </div>
        <div className="contact-item">
          <span className="icon">📍</span>
          <span>{contactInfo.address}</span>
        </div>
      </motion.div> 
    </section> // 結束 section
  );
}

export default Contact;
