import React, { useState, useEffect, useCallback } from 'react'; // Import useState and useEffect
// Remove motion import as it's no longer used for text
import { Parallax } from 'react-scroll-parallax'; // 引入 Parallax
// Remove unused particle imports
import { FaGithub, FaLinkedin, FaInstagram, FaFacebook, FaBriefcase } from 'react-icons/fa'; // 引入圖示
import './Hero.css';
import mainImage from '../assets/Main.webp'; // 更新為 webp

// Helper function for typing effect
const useTypingEffect = (text, speed = 100, startDelay = 0) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const hasStartedRef = React.useRef(false); // Use useRef to track if started

  useEffect(() => {
    // Always reset state when dependencies change
    setDisplayedText('');
    setIsTypingComplete(false);
    hasStartedRef.current = false; // Reset started flag

    let index = 0;
    let intervalId = null;
    let startTimeoutId = null;

    // Only proceed if the delay is a finite number
    if (isFinite(startDelay)) {
      const startEffect = () => {
        // Prevent starting if already started (e.g., due to fast re-renders)
        if (hasStartedRef.current) return;
        hasStartedRef.current = true; // Mark as started

        intervalId = setInterval(() => {
          if (index < text.length) {
            setDisplayedText(text.slice(0, index + 1));
            index++;
          } else {
            clearInterval(intervalId);
            setIsTypingComplete(true);
          }
        }, speed);
      };

      // Set the timeout to start the effect after the delay
      startTimeoutId = setTimeout(startEffect, startDelay);
    }

    // Cleanup function: clear timeout and interval
    return () => {
      if (startTimeoutId) clearTimeout(startTimeoutId);
      if (intervalId) clearInterval(intervalId);
    };
    // Dependencies: Effect should re-run if text, speed, or startDelay changes.
    // The logic inside handles the case where startDelay becomes finite.
  }, [text, speed, startDelay]);

  return { displayedText, isTypingComplete };
};


function Hero() {
  const fullHeading = "你好👋\n我是楊泰和";
  const fullTagline = "技術是畫筆，想像力是我的星雲。";

  // Apply typing effect hook
  const { displayedText: displayedHeading, isTypingComplete: headingComplete } = useTypingEffect(fullHeading, 100, 1000); // Start heading after 1000ms (Increased delay)
  const { displayedText: displayedTagline, isTypingComplete: taglineComplete } = useTypingEffect(fullTagline, 80, headingComplete ? 200 : Infinity); // Start tagline 200ms after heading finishes

  // 根據 Figma 設計和履歷內容
  return (
    <section // 恢復為普通 section
      id="home"
      className="hero-section"
    >
      {/* 移除 Saturn3D 和 Particles 的渲染 */}

      {/* Keep motion.div for overall content animation, but remove whileInView for text */}
      <div className="hero-content">
        {/* Apply Parallax, but remove motion from h1 */}
        <Parallax speed={10}> {/* 稍微快一點 */}
          {/* Use pre-wrap to handle newline characters */}
          <h1 className={`typing-text ${headingComplete ? 'typing-complete' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>
            {displayedHeading}
          </h1>
        </Parallax>
        {/* Apply Parallax, but remove motion from p */}
        <Parallax speed={5}> {/* 比標題慢一點，比背景快 */}
          <p className={`tagline typing-text ${taglineComplete ? 'typing-complete' : ''}`}>
            {displayedTagline}
          </p>
        </Parallax>
        {/* Description removed and moved to AboutMe component */}
        {/* 可以考慮加入 Figma 中的 "A brave climber..." 或其他標語 */}

        {/* Animate actions fade-in after tagline finishes */}
        <div className={`hero-actions ${taglineComplete ? 'fade-in' : ''}`}>
          <div className="social-links">
            <a href="https://github.com/timo9378" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
              <FaGithub />
            </a>
            <a href="https://www.linkedin.com/in/%E6%B3%B0%E5%92%8C-%E6%A5%8A-292338352/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
              <FaLinkedin />
            </a>
            <a href="https://www.instagram.com/koimsurai.23/?hl=zh-tw" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <FaInstagram />
            </a>
            <a href="https://www.facebook.com/profile.php?id=100003126780663" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <FaFacebook />
            </a>
            <a href="https://pda.104.com.tw/profile/share/6RVlSlXFeuvwusTLTlxKwpRsoBxcCu5Z" target="_blank" rel="noopener noreferrer" aria-label="104 Job Bank">
              <FaBriefcase /> {/* 使用公事包圖示代表 104 */}
            </a>
          </div>
          <a href="#contact" className="cta-button">聯絡我</a>
        </div>
      </div> {/* Close hero-content div */}
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
