import React from 'react';
import { motion } from 'framer-motion'; // 導入 motion
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'; // 引入 FontAwesomeIcon
import { faPhone, faEnvelope, faGlobe, faMapMarkerAlt } from '@fortawesome/free-solid-svg-icons'; // 引入所需圖標
import './Contact.css'; // 引入對應的 CSS 檔案

function Contact() {
  // 根據履歷內容
  const contactInfo = {
    phone: '0906503623',
    email: 'timo9378@gmail.com',
  };

  return (
    <section // 恢復為普通 section
      id="contact"
      className="contact-section"
    >
      <motion.h2 // 為標題添加動畫
        initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
        whileInView={{ opacity: 1, scale: 1 }} // 改為放大
        transition={{ duration: 0.6, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        聯絡資訊
      </motion.h2>
      <p className="contact-cta">對我的專案感興趣嗎？歡迎透過以下方式聯繫。</p> {/* 加入 CTA */}
      <div // 移除外層 motion.div，改為普通 div
        className="contact-info-container"
        // 移除外層動畫屬性
      >
        {/* 將每個聯絡項目包裝在 motion.div 中 */}
        {[
          { icon: faPhone, type: 'tel', value: contactInfo.phone, text: contactInfo.phone },
          { icon: faEnvelope, type: 'mailto', value: contactInfo.email, text: contactInfo.email },
        ].filter(item => item.value) // 過濾掉 value 為空的項目 (以防萬一)
         .map((item, index) => (
          <motion.div
            key={item.type} // 使用 type 作為 key 更穩定
            className="contact-item"
            initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
            whileInView={{ opacity: 1, scale: 1 }} // 改為放大
            transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }} // 錯開動畫
            viewport={{ once: true }}
          >
            <FontAwesomeIcon icon={item.icon} className="icon" /> {/* 使用 FontAwesomeIcon */}
            {item.type === 'tel' && <a href={`tel:${item.value}`}>{item.text}</a>}
            {item.type === 'mailto' && <a href={`mailto:${item.value}`}>{item.text}</a>}
            {item.type === 'link' && <a href={item.value} target="_blank" rel="noopener noreferrer">{item.text}</a>}
            {item.type === 'text' && <span>{item.text}</span>}
          </motion.div>
        ))}
      </div> {/* 結束普通 div */}
      {/* <div className="copyright"> © 2025 楊泰和. All rights reserved. </div> */} {/* 移除重複的版權聲明 */}
    </section>
  ); // 修正：將 ) 移到註解前
} // 修正：將 } 移到註解前

export default Contact;
