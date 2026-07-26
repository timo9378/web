import React, { useState, useEffect } from 'react'; // Import useState and useEffect
// Remove motion import as it's no longer used for text
import { Parallax } from 'react-scroll-parallax'; // 引入 Parallax
// Remove unused particle imports
// ✅ 優化: 使用解構引入 (Vite 會自動 tree-shake)
import { FaGithub, FaLinkedin, FaInstagram, FaFacebook, FaRss, FaEnvelope, FaSpotify } from 'react-icons/fa';
import './Hero.css';
import meImage from '../assets/me-avatar.webp'; // 導入頭像圖片

// Helper function for typing effect
const useTypingEffect = (text: string, speed = 100, startDelay = 0) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const hasStartedRef = React.useRef(false); // Use useRef to track if started

  useEffect(() => {
    // Always reset state when dependencies change
    setDisplayedText('');
    setIsTypingComplete(false);
    hasStartedRef.current = false; // Reset started flag

    let index = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let startTimeoutId: ReturnType<typeof setTimeout> | undefined;

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
  // Innei 式三行：名字高亮 → accent + 發光 chip（打字機）→ 小描述行。
  // hero 文案統一英文（不跟語系走），只有 chip 文字打字。
  const { displayedText: typedChip, isTypingComplete: chipComplete } = useTypingEffect('products that feel right', 80, 900);
  // 捲動提示只在頁面頂端有意義：一旦捲下去就淡出，免得那條細線一直杵在畫面上像雜訊。
  // 初值由 state initializer 取（避免在 effect 同步段呼叫 setState）；之後交給 scroll 事件。
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > 40);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 根據 Figma 設計和履歷內容
  return (
    <section // 恢復為普通 section
      id="home"
      className="hero-section"
    >
      {/* 移除 Saturn3D 和 Particles 的渲染 */}

      {/* Keep motion.div for overall content animation, but remove whileInView for text */}
      <div className="home-hero-content">
        <Parallax speed={10}>
          <h1 className="hero-line1">
            {"Hi, I'm "}
            <span className="hero-name-wrap">
              <span className="hero-name">Koimsurai</span>
              {' '}
              <span className="emoji-native hero-wave">👋</span>
            </span>
          </h1>
        </Parallax>
        <Parallax speed={5}>
          <p className="hero-line2">
            {'I shape '}
            <em className="hero-accent">ideas</em>
            {' into '}
            <span className="hero-chip hero-chip--rift">
              <span className="hero-chip-spark" aria-hidden="true">✦</span>
              <span className="hero-chip-text" data-text={typedChip}>{typedChip}</span>
              <span className="hero-caret" aria-hidden="true" />
            </span>
          </p>
        </Parallax>
        <p className={`hero-sub ${chipComplete ? 'fade-in' : ''}`}>
          A FULL-STACK ENGINEER BUILDING INTERFACES, SYSTEMS, AND A TINY UNIVERSE.
        </p>

        {/* Animate actions fade-in after chip finishes */}
        <div className={`hero-actions ${chipComplete ? 'fade-in' : ''}`}>
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
            <a href="https://open.spotify.com/user/x6l1h2n0fxtivlao8prrfq1pj?si=b31c38eb1a734038" target="_blank" rel="noopener noreferrer" aria-label="Spotify">
              <FaSpotify />
            </a>
            <a href="mailto:timo9378@gmail.com" aria-label="Email">
              <FaEnvelope />
            </a>
            <a href="/api/rss" target="_blank" rel="noopener noreferrer" aria-label="RSS">
              <FaRss />
            </a>
          </div>
          {/* 聯絡 CTA 已移除 — 社群連結與頁尾訊號區已涵蓋聯絡方式 */}
        </div>
      </div> {/* Close home-hero-content div */}

      {/* 新增頭像區塊 */}
      <div className="hero-avatar-wrapper">
        <img
          src={meImage}
          alt="Koimsurai Avatar"
          className="hero-avatar"
          draggable="false"
          fetchPriority="high"
          decoding="async"
          width="280"
          height="280"
        />
      </div>

      {/* Figma 中還有一個巨大的背景文字 "Sergio"，可以考慮加入 */}
      <div className="background-text">Koimsurai</div> {/* 加入背景文字 */}

      {/* scroll 提示線 — 跟 hero-actions 同步淡入 */}
      <div className={`hero-scroll-cue ${chipComplete && !scrolled ? 'fade-in' : ''}`} aria-hidden="true"><span /></div>
    </section> // 結束 section
  );
}

export default Hero;
