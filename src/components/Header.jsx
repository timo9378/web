import React from 'react'; // Removed useState, useEffect
import { FaHome, FaUser, FaCode, FaBriefcase, FaUsers, FaImages, FaEnvelope, FaDownload } from 'react-icons/fa'; // Import icons
import './Header.css'; // 引入對應的 CSS 檔案

// Updated Header to accept activeSection prop
function Header({ activeSection }) {
  // Removed the useEffect and useState for scroll detection

  // Helper function to create nav links with icons
  const NavLink = ({ href, sectionId, icon: Icon, text }) => (
    <li>
      <a href={href} className={activeSection === sectionId ? 'active' : ''}>
        <Icon className="nav-icon" /> {/* Add class for potential styling */}
        {text}
      </a>
    </li>
  );

  return (
    // Pass style prop down if needed, or handle styling within Header.css
    <header className="app-header">
      <div className="logo">楊泰和</div> {/* 根據履歷圖片 */}
      <nav>
        {/* Use NavLink helper and pass activeSection */}
        <ul>
          <NavLink href="#home" sectionId="home" icon={FaHome} text="首頁" />
          <NavLink href="#about-me" sectionId="about-me" icon={FaUser} text="關於我" />
          <NavLink href="#expertise" sectionId="expertise" icon={FaCode} text="專業技能" />
          <NavLink href="#work-experience" sectionId="work-experience" icon={FaBriefcase} text="工作經驗" />
          <NavLink href="#school-clubs" sectionId="school-clubs" icon={FaUsers} text="社團經驗" />
          <NavLink href="#portfolio" sectionId="portfolio" icon={FaImages} text="作品集" />
          <NavLink href="#contact" sectionId="contact" icon={FaEnvelope} text="聯絡我" />
        </ul>
      </nav>
      <button className="download-button">
        <FaDownload className="download-icon" /> {/* Add download icon */}
        下載履歷
      </button> {/* Figma 中是 "下载简历与作品集" */}
    </header>
  );
}

export default Header;
