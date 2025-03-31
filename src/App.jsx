import React from 'react';
import Header from './components/Header'; // 引入 Header 元件
import Hero from './components/Hero'; // 引入 Hero 元件
import Expertise from './components/Expertise'; // 引入 Expertise 元件
import WorkExperience from './components/WorkExperience'; // 引入 WorkExperience 元件
// import Education from './components/Education'; // 移除 Education 導入
import SchoolClubs from './components/SchoolClubs'; // 引入 SchoolClubs 元件
import Portfolio from './components/Portfolio'; // 引入 Portfolio 元件
import Contact from './components/Contact'; // 引入 Contact 元件
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'; // 導入 React Router 元件
// import Header from './components/Header'; // 移除重複導入
// import Hero from './components/Hero'; // 移除重複導入
// import Expertise from './components/Expertise'; // 移除重複導入
// import WorkExperience from './components/WorkExperience'; // 移除重複導入
// import Education from './components/Education'; // 移除重複導入
// import Portfolio from './components/Portfolio'; // 移除重複導入
// import Contact from './components/Contact'; // 移除重複導入
import Footer from './components/Footer'; // 引入 Footer 元件
import PhotoGallery from './components/PhotoGallery'; // 引入 PhotoGallery 元件
import './App.css';

// 創建主頁元件
function MainPage() {
  return (
    <>
      <Header /> {/* Header 在主頁顯示 */}
      <main>
        <Hero />
        <Expertise />
        <WorkExperience />
        <SchoolClubs /> {/* 使用 SchoolClubs 元件 */}
        <Portfolio /> {/* 主頁顯示卡片式 Portfolio */}
        <Contact />
      </main>
      <Footer /> {/* Footer 在主頁顯示 */}
    </>
  );
}

function App() {
  return (
    // <Router> {/* 移除這裡多餘的 Router 包裹 */}
      <div className="App">
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/photos" element={
            <>
              {/* 考慮是否在照片頁也顯示 Header/Footer */}
              {/* <Header /> */}
              <PhotoGallery />
              {/* <Footer /> */}
            </>
          } />
        </Routes>
      </div>
    // </Router>
  );
}

export default App;
