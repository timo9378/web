import React from 'react';
import './Header.css'; // 引入對應的 CSS 檔案

function Header() {
  // 從 Figma 分析，導覽列包含 姓名/Logo、首頁、作品、博客、關於我、下載履歷按鈕
  // 這裡先建立基本結構
  return (
    <header className="app-header">
      <div className="logo">楊泰和</div> {/* 根據履歷圖片 */}
      <nav>
        <ul>
          <li><a href="#home" className="active">首頁</a></li> {/* Figma 中 "首页" 是活躍狀態 */}
          <li><a href="#portfolio">作品</a></li> {/* 更新 href 指向 portfolio */}
          {/* <li><a href="#blog">博客</a></li> */} {/* 移除博客 */}
          <li><a href="#contact">關於我</a></li> {/* 暫時指向 contact */}
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
