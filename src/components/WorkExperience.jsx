import React from 'react';
import { motion } from 'framer-motion'; // 導入 motion
import './WorkExperience.css'; // 引入對應的 CSS 檔案

function WorkExperience() {
  // 根據履歷內容
  const experiences = [
    {
      period: '2024 - Now',
      title: '私立高偉數學補習班',
      role: '資訊助理 & 企劃部門',
      details: [
        '成功開發補習班 Android App & 上線維運',
        '完成其他主管交辦事項',
        '數十支宣傳用 10 分內長片剪輯、封面製作'
      ]
    },
    {
      period: '2024 - Now',
      title: '猿創力程式設計學校',
      role: '儲備講師',
      details: [
        '教導國中、國小學生程式，小班制 MCE、Python 為主',
        'App Inventor 到府一對一比賽特訓班'
      ]
    },
    {
      period: '2024 - Now', // 注意：履歷上 Senior Project 也是 2024-Now，這裡暫時放在工作經歷，也可考慮移至獨立區塊
      title: 'Senior Project',
      role: '基於碳權之電動車充電化遊戲 App',
      details: [
        '結合碳權概念、電動車充電資訊、遊戲化元素的 App',
        '結合 MongoDB、網站及伺服器架設、Flutter 全端開發',
        'Git 版本控制、Docker 部署、AAOS 取得車輛資訊'
      ]
    }
  ];

  return (
    <section // 恢復為普通 section
      id="work-experience"
      className="work-experience-section"
    >
      <motion.h2 // 為標題添加動畫
        initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
        whileInView={{ opacity: 1, scale: 1 }} // 改為放大
        transition={{ duration: 0.6, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        工作經歷
      </motion.h2>
      <div // 移除外層 motion.div，改為普通 div
        className="experience-list"
        // 移除外層動畫屬性
      >
        {experiences.map((exp, index) => (
          <motion.div // 為每個項目添加動畫
            key={index}
            className="experience-item"
            initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
            whileInView={{ opacity: 1, scale: 1 }} // 改為放大
            transition={{ duration: 0.5, delay: index * 0.15, ease: "easeOut" }} // 錯開動畫，延遲稍長
            viewport={{ once: true }}
          >
            <div className="experience-header">
              <h3>{exp.title} <span className="role">({exp.role})</span></h3>
              <span className="period">{exp.period}</span>
            </div>
            <ul className="details-list">
              {exp.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          </motion.div> // 結束 motion.div
        ))}
      </div> // 結束普通 div
    </section> // 結束 section
  );
}

export default WorkExperience;
