import React, { useState, useEffect, useRef } from 'react'; // 引入 useState, useEffect, useRef
import { motion } from 'framer-motion'; // 導入 motion
import {
  SiFigma, SiDart, SiMongodb, SiAdobepremierepro, SiAdobelightroom, SiKotlin, SiNotion, SiCanva // 新增 Notion, Canva
} from 'react-icons/si'; // 設計/影音/DB/Mobile/生產力
import {
  FaJava, FaPython, FaLinux, FaGithub, FaDocker, FaNetworkWired, FaServer
} from 'react-icons/fa'; // 後端/工具/網路
import './Expertise.css'; // 引入對應的 CSS 檔案

// 將圖示元件化以便複用
const SkillIcon = ({ icon: Icon, name, description, showTooltip, hideTooltip, animationProps }) => (
  <motion.span
    className="skill-icon"
    title={name}
    animate={animationProps || { y: [0, -2, 0], rotate: Math.random() > 0.5 ? [0, 3, -3, 0] : 0 }} // 加入隨機旋轉
    transition={{ duration: 1.5 + Math.random() * 1.5, repeat: Infinity, ease: "easeInOut" }}
    onMouseEnter={(e) => showTooltip(description, e)}
    onMouseLeave={hideTooltip}
  >
    <Icon />
  </motion.span>
);


function Expertise() {
  // 更新技能分類和內容，新增 Productivity & Design
  const skills = {
    'Mobile Development': ['Dart', 'Kotlin'],
    'Productivity & Design': ['Figma', 'Notion', 'Canva'], // 新增分類，放入 Figma, Notion, Canva
    'Back-end': ['Java', 'Python', 'MongoDB'],
    'DevOps & Tools': ['Linux', 'Github', 'Docker'],
    '影音剪輯': ['Premiere Pro', 'Lightroom'],
    '網路技術': ['TCP/IP', 'HTTP/HTTPS']
  };

   // --- Tooltip State and Logic ---
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
  const tooltipRef = useRef(null);

  const showTooltip = (content, event) => {
    const rect = event.target.getBoundingClientRect();
    setTooltip({
      visible: true,
      content: content,
      // 定位在圖示右上角
      x: rect.right + window.scrollX, // X 定位在圖示右邊緣
      y: rect.top + window.scrollY,   // Y 定位在圖示頂部
    });
  };

  const hideTooltip = () => {
    setTooltip({ ...tooltip, visible: false });
  };

  // --- End Tooltip Logic ---


  return (
    <section // 恢復為普通 section
      id="expertise"
      className="expertise-section"
    >
      <motion.h2 // 為標題添加動畫
        initial={{ opacity: 0, scale: 0.8 }} // 改為縮小
        whileInView={{ opacity: 1, scale: 1 }} // 改為放大
        transition={{ duration: 0.6, ease: "easeOut" }}
        viewport={{ once: true }}
      >
        專業技能
      </motion.h2>
      <div // 移除外層 motion.div，改為普通 div
        className="skills-container"
        // 移除外層動畫屬性
      >
        {Object.entries(skills).map(([category, items], index) => ( // 加入 index
          <motion.div // 為每個分類添加動畫
            key={category}
            className="skill-category"
            initial={{ opacity: 0, scale: 0.8 }} // 移除 y，調整 scale
            whileInView={{ opacity: 1, scale: 1 }} // 移除 y
            transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }} // 錯開動畫
            viewport={{ once: true }}
          >
            <h3>{category}</h3>
            {/* 改用 div 包裹技能項目，取代 ul */}
            <div className="skill-items-wrapper">
             {items.map((item) => (
                // 改用 div 包裹單個技能，取代 li
                <div key={item} className="skill-item">
                  {/* 使用 SkillIcon 元件 */}
                  {item === 'Dart' ? <SkillIcon icon={SiDart} name="Dart (Flutter)" description="Flutter App 開發語言" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Kotlin' ? <SkillIcon icon={SiKotlin} name="Kotlin" description="Android/跨平台開發語言" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Figma' ? <SkillIcon icon={SiFigma} name="Figma" description="UI/UX 設計工具" showTooltip={showTooltip} hideTooltip={hideTooltip} animationProps={{ rotate: [0, 5, -5, 0], y: [0, -2, 2, 0] }} /> :
                   item === 'Notion' ? <SkillIcon icon={SiNotion} name="Notion" description="筆記與協作工具" showTooltip={showTooltip} hideTooltip={hideTooltip} /> : // 新增 Notion
                   item === 'Canva' ? <SkillIcon icon={SiCanva} name="Canva" description="線上設計平台" showTooltip={showTooltip} hideTooltip={hideTooltip} /> : // 新增 Canva
                   item === 'Java' ? <SkillIcon icon={FaJava} name="Java" description="後端程式語言" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Python' ? <SkillIcon icon={FaPython} name="Python" description="多用途程式語言" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'MongoDB' ? <SkillIcon icon={SiMongodb} name="MongoDB" description="NoSQL 資料庫" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Linux' ? <SkillIcon icon={FaLinux} name="Linux" description="作業系統" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Github' ? <SkillIcon icon={FaGithub} name="GitHub" description="版本控制平台" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Docker' ? <SkillIcon icon={FaDocker} name="Docker" description="容器化平台" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Premiere Pro' ? <SkillIcon icon={SiAdobepremierepro} name="Premiere Pro" description="影片剪輯軟體" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'Lightroom' ? <SkillIcon icon={SiAdobelightroom} name="Lightroom" description="相片編修軟體" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'TCP/IP' ? <SkillIcon icon={FaNetworkWired} name="TCP/IP" description="網路通訊協定" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   item === 'HTTP/HTTPS' ? <SkillIcon icon={FaServer} name="HTTP/HTTPS" description="Web 應用層協定" showTooltip={showTooltip} hideTooltip={hideTooltip} /> :
                   <span className="skill-text">{item}</span> // 如果沒有對應圖示，顯示文字
                  }
                  {/* 在圖示下方添加綠色向上箭頭 */}
                  <span className="skill-arrow">▲</span>
                </div>
              ))}
            </div>
          </motion.div> // 結束 motion.div
        ))}
      </div> 

      {/* Tooltip 元件 */}
      {tooltip.visible && (
        <div
          ref={tooltipRef}
          className="skill-tooltip"
          style={{
            position: 'absolute', // 使用絕對定位
            left: `${tooltip.x}px`, // X 來自計算結果
            top: `${tooltip.y}px`,  // Y 來自計算結果
            transform: 'translateY(-100%) translateX(5px)', // 向上移動自身高度，再向右移動一點點
          }}
        >
          {tooltip.content}
        </div>
      )}
    </section> // 結束 section
  );
}

export default Expertise;
