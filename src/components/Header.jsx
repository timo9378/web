import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom'; // 導入 useLocation 和 useNavigate
import { FaHome, FaUser, FaCode, FaBriefcase, FaUsers, FaImages, FaEnvelope, FaDownload } from 'react-icons/fa';
import './Header.css';

// Updated Header to accept activeSection prop and handle navigation
function Header({ activeSection }) {
  const location = useLocation(); // 獲取當前位置
  const navigate = useNavigate(); // 獲取導航函數
  const isHomePage = location.pathname === '/'; // 判斷是否在主頁

  // 處理導航點擊
  const handleNavClick = (e, sectionId) => {
    e.preventDefault(); // 阻止默認的錨點跳轉行為

    if (isHomePage) {
      // 在主頁，平滑滾動
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      // 不在主頁，跳轉回主頁並帶上 hash
      navigate(`/#${sectionId}`);
    }
  };

  // Helper function to create nav links with icons and click handler
  const NavLink = ({ sectionId, icon: Icon, text }) => (
    <li>
      {/* 使用 onClick 處理導航，href 保持 #id 以便語義化和潛在的直接訪問 */}
      <a
        href={`#${sectionId}`}
        className={activeSection === sectionId && isHomePage ? 'active' : ''} // 僅在主頁時根據 activeSection 添加 active class
        onClick={(e) => handleNavClick(e, sectionId)}
      >
        <Icon className="nav-icon" />
        {text}
      </a>
    </li>
  );

  return (
    <header className="app-header">
      <div className="logo">楊泰和</div> {/* 根據履歷圖片 */}
      <nav>
        <ul>
          {/* 移除 href，傳遞 sectionId */}
          <NavLink sectionId="home" icon={FaHome} text="首頁" />
          <NavLink sectionId="about-me" icon={FaUser} text="關於我" />
          <NavLink sectionId="expertise" icon={FaCode} text="專業技能" />
          <NavLink sectionId="work-experience" icon={FaBriefcase} text="工作經驗" />
          <NavLink sectionId="school-clubs" icon={FaUsers} text="社團經驗" />
          <NavLink sectionId="portfolio" icon={FaImages} text="作品集" />
          <NavLink sectionId="contact" icon={FaEnvelope} text="聯絡我" />
        </ul>
      </nav>
      {/* TODO: 下載履歷按鈕功能 */}
      <button className="download-button" onClick={() => alert('下載功能待實現')}>
        <FaDownload className="download-icon" /> {/* Add download icon */}
        下載履歷
      </button> {/* Figma 中是 "下载简历与作品集" */}
    </header>
  );
}

export default Header;
