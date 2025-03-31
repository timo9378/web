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
      <h2>工作經歷</h2>
      <motion.div // 將動畫應用於 experience-list
        className="experience-list"
        initial={{ opacity: 0, y: 50 }} // 初始狀態
        whileInView={{ opacity: 1, y: 0 }} // 進入視圖時的狀態
        transition={{ duration: 0.8, ease: "easeOut" }} // 動畫效果
        viewport={{ once: true }} // 動畫只觸發一次
      >
        {experiences.map((exp, index) => (
          <div key={index} className="experience-item">
            <div className="experience-header">
              <h3>{exp.title} <span className="role">({exp.role})</span></h3>
              <span className="period">{exp.period}</span>
            </div>
            <ul className="details-list">
              {exp.details.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          </div>
        ))}
      </motion.div> 
    </section> // 結束 section
  );
}

export default WorkExperience;
