import React, { useState } from 'react'; // 引入 useState
import { motion, AnimatePresence } from 'framer-motion'; // 重新導入 AnimatePresence
import './SchoolClubs.css'; // 引入新的 CSS 檔案
// 引入圖標
import { FaUniversity, FaGuitar, FaCamera } from 'react-icons/fa';

// 更新社團經歷資料，加入圖標和詳細活動
const clubs = [
  {
    name: '111屆資管系學會',
    role: '會長',
    icon: FaUniversity, // 系學會圖標
    activities: [
      '宿營 活動副組長',
      '迎新茶會 總召、主持人',
      '十三系聯合聖誕夜店趴 副召',
      '系座談會 總召、主持人'
    ]
  },
  {
    name: '112屆絃韻吉他社',
    role: '文書',
    icon: FaGuitar, // 吉他社圖標
    activities: [
      '吉他太美(迎新) 總召',
      '詐騙吉團(期初) 攝影',
      '吉拜郎(民歌之夜) 副召、攝影',
      '七校聯展 協辦',
      '吉卜力(社友會) 場佈、主持人',
      '吉良吉影(期末) 公關組長、攝影組長',
      '吉惡世代(期初下) 副召、主持人',
      '金絃獎 文宣、內招組長'
    ]
  },
  {
    name: '第一屆台科攝影社',
    role: '教學',
    icon: FaCamera, // 攝影社圖標
    activities: [
      '社課教學與規劃', // 根據職位推斷或補充
      '外拍活動帶領'
    ]
  }
];

function SchoolClubs() {
  const [expandedIndex, setExpandedIndex] = useState(null); // 追蹤展開的卡片索引

  // 點擊卡片時的處理函數
  const handleCardClick = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index); // 如果點擊已展開的卡片則收合，否則展開新的
  };

  return (
    <section id="school-clubs" className="school-clubs-section">
      {/* 更新標題 */}
      <motion.h2 // 為標題添加動畫
        initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
        whileInView={{ opacity: 1, scale: 1 }} // 改為放大
        transition={{ duration: 0.6, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        社團經歷
      </motion.h2>
      <div className="clubs-container">
        {/* 遍歷社團資料並顯示 */}
        {clubs.map((club, index) => (
          <motion.div
            key={index}
            className={`club-item ${expandedIndex === index ? 'expanded' : ''}`}
            initial={{ opacity: 0, scale: 0.8 }} // 移除 y，調整 scale
            whileInView={{ opacity: 1, scale: 1 }} // 移除 y
            transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
            viewport={{ once: true }}
            onClick={() => handleCardClick(index)} // 保留點擊事件
          >
            <div className="club-header"> {/* 新增 header 包裹圖標和標題 */}
              {/* 顯示圖標 */}
              <club.icon className="club-icon" />
              <h3>{club.name}</h3>
            </div>
            <p>{club.role}</p>
            {/* 保持內部的 AnimatePresence 和 motion.div */}
            <AnimatePresence>
              {expandedIndex === index && (
                <motion.div
                  key="activities"
                  className="club-activities"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ul>
                    {club.activities.map((activity, actIndex) => (
                      <li key={actIndex}>{activity}</li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div> // 恢復外層 motion.div
        ))}
      </div>
    </section>
  );
}

export default SchoolClubs;
