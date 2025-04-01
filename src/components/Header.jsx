import React, { useState, useEffect } from 'react';
import './Header.css'; // 引入對應的 CSS 檔案

function Header() {
  const [activeLink, setActiveLink] = useState('home'); // 初始 active 狀態為 home

  useEffect(() => {
    const handleScroll = () => {
      const sections = ['home', 'portfolio', 'contact']; // 對應的 section ID
      const headerHeight = 70; // Header 高度，用於偏移計算
      let currentSection = ''; // 初始為空

      // 計算稍微偏移後的滾動位置，以提高觸發精準度
      const scrollPosition = window.scrollY + headerHeight + 10; // 增加一點偏移量

      sections.forEach(id => {
        const sectionElement = document.getElementById(id);
        if (sectionElement) {
          const sectionTop = sectionElement.offsetTop;

          // 如果滾動位置超過了這個區塊的頂部，就將它設為當前區塊
          // 這樣會自動選中最後一個滾動經過的區塊
          if (scrollPosition >= sectionTop) {
            currentSection = id;
          }
        }
      });

      // 如果遍歷完所有區塊後 currentSection 仍然是空的（例如在頁面最頂部）
      // 或者滾動位置非常靠近頂部，則強制設為第一個區塊 'home'
      if (!currentSection || window.scrollY < headerHeight / 2) {
        currentSection = 'home';
      }

      // --- 新增：處理滾動到底部的情況 ---
      // 獲取文檔總高度和視窗高度
      const scrollHeight = document.documentElement.scrollHeight;
      const innerHeight = window.innerHeight;
      const distanceToBottom = scrollHeight - innerHeight - window.scrollY;
      // 判斷是否接近底部 (例如，相差 10px 以內)
      if (distanceToBottom < 10) {
        // 如果接近底部，強制設為最後一個區塊 'contact'
        currentSection = 'contact';
      }
      // --- 結束新增 ---

      setActiveLink(currentSection);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // 初始加載時也執行一次

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  return (
    <header className="app-header">
      <div className="logo">楊泰和</div> {/* 根據履歷圖片 */}
      <nav>
        <ul>
          {/* 根據 activeLink 狀態動態添加 active class，並加入圖標 */}
          <li><a href="#home" className={activeLink === 'home' ? 'active' : ''}><span className="nav-icon">🏠</span>首頁</a></li>
          <li><a href="#portfolio" className={activeLink === 'portfolio' ? 'active' : ''}><span className="nav-icon">🪐</span>作品</a></li>
          {/* <li><a href="#blog">博客</a></li> */} {/* 移除博客 */}
          <li><a href="#contact" className={activeLink === 'contact' ? 'active' : ''}><span className="nav-icon">🧑‍🚀</span>關於我</a></li>
        </ul>
      </nav>
      <button className="download-button">
        {/* 之後會加入下載圖標 */}
        下載履歷
      </button> {/* Figma 中是 "下载简历与作品集" */}
    </header>
  );
}

export default Header;
