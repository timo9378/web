import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRocket } from '@fortawesome/free-solid-svg-icons'; // 改用火箭圖標
import './BackToTopButton.css';

function BackToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  // 監聽滾動事件
  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 300) { // 向下滾動超過 300px 時顯示按鈕
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', toggleVisibility);

    // 清除監聽器
    return () => window.removeEventListener('scroll', toggleVisibility);
  }, []);

  // 滾動到頂部
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth' // 平滑滾動
    });
  };

  return (
    <button
      className={`back-to-top-button ${isVisible ? 'show' : ''}`}
      onClick={scrollToTop}
      aria-label="回到頂部"
    >
      <FontAwesomeIcon icon={faRocket} />
    </button>
  );
}

export default BackToTopButton;
