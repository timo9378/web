import React, { useCallback } from 'react'; // 移除 useEffect
import { motion } from 'framer-motion'; // 導入 motion
import Particles from "react-tsparticles"; // Corrected import path
import { loadSlim } from "tsparticles-slim"; // Corrected import path for slim engine
import './Hero.css'; // 引入對應的 CSS 檔案
import mainImage from '../assets/Main.JPG'; // 導入圖片

function Hero() {
  // 使用 useCallback 創建 init 函數
  const particlesInit = useCallback(async (engine) => {
    // console.log(engine); // 用於調試
    // 初始化引擎，載入 slim 版本
    await loadSlim(engine);
  }, []);

  // 粒子配置選項 (保持不變)
  const particlesOptions = {
    background: {
      // color: { value: "var(--clr-bg-primary)" }, // 背景色由 Hero.css 控制
    },
    fpsLimit: 60, // 限制幀率以優化效能
    interactivity: {
      events: {
        onHover: {
          enable: true,
          mode: "repulse", // 滑鼠懸停時排斥粒子
        },
        // onClick: { enable: true, mode: "push" }, // 點擊時添加粒子 (可選)
      },
      modes: {
        repulse: { distance: 80, duration: 0.4 },
        // push: { quantity: 4 },
      },
    },
    particles: {
      color: { value: "#ffffff" }, // 粒子顏色 (白色) - 使用 --clr-headline 變數可能更好
      links: {
        color: "#ffffff", // 連接線顏色 - 使用 --clr-headline 變數可能更好
        distance: 150,
        enable: true, // 啟用連接線
        opacity: 0.1, // 連接線透明度
        width: 1,
      },
      move: {
        direction: "none",
        enable: true,
        outModes: { default: "out" }, // 粒子移出畫布時的行為
        random: true, // 隨機移動
        speed: 0.5, // 移動速度
        straight: false,
      },
      number: {
        density: { enable: true, area: 800 }, // 粒子密度
        value: 50, // 粒子數量
      },
      opacity: { value: 0.3 }, // 粒子透明度
      shape: { type: "circle" }, // 粒子形狀
      size: { value: { min: 1, max: 3 } }, // 粒子大小範圍
    },
    detectRetina: true, // 支援 Retina 螢幕
  };


  // 根據 Figma 設計和履歷內容
  return (
    <section // 恢復為普通 section
      id="home"
      className="hero-section"
    >
      {/* 渲染粒子效果，放在最底層 */}
       <Particles
          id="tsparticles"
          init={particlesInit} // 使用 init 屬性初始化
          options={particlesOptions}
          className="particles-background" // 添加 class 以便 CSS 定位
        />

      <motion.div // 將動畫應用於 hero-content
        className="hero-content"
        initial={{ opacity: 0, y: 50 }} // 初始狀態
        whileInView={{ opacity: 1, y: 0 }} // 進入視圖時的狀態
        transition={{ duration: 0.8, ease: "easeOut" }} // 動畫效果
        viewport={{ once: true }} // 動畫只觸發一次
      >
        {/* Figma: "你好👋， 我是三秋十李" -> 替換成履歷姓名 */}
        <h1>你好👋<br />我是楊泰和</h1>
        {/* Figma: "一个在产品设计届努力攀登的新生..." -> 替換成履歷 Profile 或自訂標語 */}
        {/* 履歷 Profile: 國立台灣科技大學資訊管理系三年級學生... */}
        <p className="tagline">Software Engineer</p> {/* 來自履歷 */}
        <p className="description">
          國立台灣科技大學資訊管理系三年級學生，具備 C++、Python、Java 等程式語言基礎，以及一年以上的 Android 與 Flutter App 開發經驗。熟悉 Figma UI/UX 設計，並善用 GitHub 與 Notion 進行版本控制與專案管理。 {/* 截取自履歷 Profile */}
        </p>
        {/* 可以考慮加入 Figma 中的 "A brave climber..." 或其他標語 */}

        {/* 新增：社群連結與 CTA 按鈕 */}
        <div className="hero-actions">
          <div className="social-links">
            {/* 暫用文字，之後可換成圖示 */}
            <a href="https://github.com/your-github" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://linkedin.com/in/your-linkedin" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            {/* 可以添加更多連結 */}
          </div>
          <a href="#contact" className="cta-button">聯絡我</a>
        </div>
      </motion.div> {/* 正確關閉 motion.div */}
      <div className="hero-image-container"> {/* 圖片容器移到 motion.div 外部 */}
        {/* 這裡可以放置 Figma 中的圖片或個人照片 */}
        {/* Figma 圖片 ID: 20:6 (画形态) 和 24:70 (截屏...) */}
        {/* 將佔位符替換為圖片 */}
        <img src={mainImage} alt="楊泰和" className="hero-image" />
      </div>
      {/* 新增：裝飾性元素 */}
      <div className="hero-decoration hero-decoration-1"></div>
      <div className="hero-decoration hero-decoration-2"></div>
      {/* Figma 中還有一個巨大的背景文字 "Sergio"，可以考慮加入 */}
      <div className="background-text">Koimsurai</div> {/* 加入背景文字 */}
    </section> // 結束 section
  );
}

export default Hero;
