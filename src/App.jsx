import React, { useState, useEffect, useCallback } from 'react'; // Import useCallback
import { ParallaxProvider } from 'react-scroll-parallax';
import { useInView } from 'react-intersection-observer'; // Import useInView
import LoadingScreen from './components/LoadingScreen'; // Import LoadingScreen
import Saturn3D from './components/Saturn3D';
import IntroAnimation from './components/IntroAnimation';
import Header from './components/Header';
import Hero from './components/Hero';
import AboutMe from './components/AboutMe'; // <-- 引入 AboutMe
import Expertise from './components/Expertise';
import WorkExperience from './components/WorkExperience';
import SchoolClubs from './components/SchoolClubs';
import Portfolio from './components/Portfolio';
import Contact from './components/Contact';
import { BrowserRouter, Routes, Route } from 'react-router-dom'; // Import BrowserRouter here
import Footer from './components/Footer';
import PhotoGallery from './components/PhotoGallery';
import CursorTrail from './components/CursorTrail';
import TransitionAnimation from './components/TransitionAnimation';
import RandomShootingStars from './components/RandomShootingStars';
import RandomComets from './components/RandomComets'; // 導入彗星元件
import RandomUFOs from './components/RandomUFOs'; // 導入 UFO 元件
import BackToTopButton from './components/BackToTopButton'; // 導入回到頂部按鈕
import TwinklingStars from './components/TwinklingStars'; // <--- 導入閃爍星星元件
import ForegroundStars from './components/ForegroundStars'; // <--- 導入前景星星元件
import { ScrollControls, Scroll, Stars, useScroll, Points, PointMaterial } from '@react-three/drei'; // Import Points and PointMaterial
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef, useMemo } from 'react'; // Add useMemo
import * as THREE from 'three'; // Import THREE
import './App.css';

// --- Section Wrapper Component ---
// This component wraps each section and uses useInView to track visibility
function SectionWrapper({ id, children, onInViewChange }) {
  const { ref, inView } = useInView({
    threshold: 0.5, // Trigger when 50% of the section is visible
    // rootMargin: '-50% 0px -50% 0px', // Adjust root margin if needed, e.g., only trigger when near center
    triggerOnce: false, // Keep observing
  });

  useEffect(() => {
    if (inView) {
      onInViewChange(id);
    }
  }, [inView, id, onInViewChange]);

  return (
    <section id={id} ref={ref}>
      {children}
    </section>
  );
}


// 主頁元件 - Modified to use SectionWrapper
function MainPage({ onSectionChange }) { // Accept callback prop
  return (
    <>
      {/* Header is now outside MainPage */}
      <main>
        <SectionWrapper id="home" onInViewChange={onSectionChange}>
          <Hero />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="about-me" onInViewChange={onSectionChange}>
          <AboutMe />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="expertise" onInViewChange={onSectionChange}>
          <Expertise />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="work-experience" onInViewChange={onSectionChange}>
          <WorkExperience />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="school-clubs" onInViewChange={onSectionChange}>
          <SchoolClubs />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="portfolio" onInViewChange={onSectionChange}>
          <Portfolio />
        </SectionWrapper>
        <TransitionAnimation />
        <SectionWrapper id="contact" onInViewChange={onSectionChange}>
          <Contact />
        </SectionWrapper>
      </main>
      {/* Footer is now outside MainPage */}
    </>
  );
}

// --- 用於星空背景的內部元件 ---
// 修改 StarfieldScene 以接受 mainStarsRef
function StarfieldScene({ mainStarsRef }) {
  // const starsRef = useRef(); // <--- 移除內部 ref
  const galaxyRef = useRef(); // Ref for the galaxy band
  const scrollSpeedMultiplier = useRef(1); // Ref to store scroll-based speed multiplier
  const scrollTimeoutRef = useRef(null); // Ref to store the timeout ID
  const baseSpeedMultiplier = 1; // 基礎速度
  const boostedSpeedMultiplier = 3; // 滾動時加速到的倍數 (可調整)
  const scrollResetDelay = 150; // 滾動停止後多少毫秒恢復基礎速度 (可調整)

  // Effect to listen to scroll and temporarily boost speed
  useEffect(() => {
    const handleScroll = () => {
      // 滾動時立即提升速度
      scrollSpeedMultiplier.current = boostedSpeedMultiplier;

      // 清除之前的計時器 (如果存在)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // 設置新的計時器，在延遲後恢復基礎速度
      scrollTimeoutRef.current = setTimeout(() => {
        scrollSpeedMultiplier.current = baseSpeedMultiplier;
      }, scrollResetDelay);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // 清理函數
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current); // 組件卸載時清除計時器
      }
    };
  }, []); // 空依賴數組，僅在掛載和卸載時運行

  useFrame((state, delta) => {
    // 使用傳入的 mainStarsRef
    if (mainStarsRef.current) {
      // 獲取當前速度乘數
      const speedMultiplier = scrollSpeedMultiplier.current;
      // 應用基礎自轉，並乘以速度乘數
      mainStarsRef.current.rotation.x += delta * 0.01 * speedMultiplier;
      mainStarsRef.current.rotation.y += delta * 0.02 * speedMultiplier;
      // 移除位置變化
    }
    // Rotate galaxy band (link to main stars rotation or have slightly different speed)
    if (galaxyRef.current) {
       const speedMultiplier = scrollSpeedMultiplier.current; // Or a fixed speed
       // Example: Slightly slower rotation than main stars
       galaxyRef.current.rotation.x += delta * 0.008 * speedMultiplier;
       galaxyRef.current.rotation.y += delta * 0.015 * speedMultiplier;
    }
  });

  return (
    <> {/* Use Fragment to return multiple elements */}
    <Stars
      ref={mainStarsRef} // <--- 使用傳入的 ref
      radius={100}
      depth={50}
      count={10000}
      factor={3.5} // Slightly smaller base size
      saturation={0.1} // Add subtle color variation
      fade
      speed={0.5} // Keep original speed for general stars
    />
    {/* 新增：銀河帶 */}
    <Stars
      ref={galaxyRef} // Use a separate ref if needed for independent control, or reuse starsRef if rotation is linked
      radius={90} // Slightly smaller radius than the main stars
      depth={20}  // Much shallower depth to create a band
      count={8000} // High count for density
      factor={5}   // Larger factor for brighter/bigger stars in the band
      saturation={0.2} // Slight saturation for a subtle color hint (optional)
      fade
      speed={0.3} // Slightly different speed for parallax (optional)
      // Initial rotation to create the band angle
      rotation={[0, Math.PI / 3, Math.PI / 5]} // Adjusted tilt for the galaxy band
    />
    </> // Close Fragment
  );
}

// --- 新增：太空碎片元件 ---
function SpaceDebris({ count = 200 }) {
  const pointsRef = useRef();
  // Removed galaxyRef from here

  // Removed misplaced useFrame from here

  // 隨機生成碎片位置
  const particlesPosition = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const distance = 100; // 碎片分佈範圍半徑

    for (let i = 0; i < count; i++) {
      const theta = THREE.MathUtils.randFloatSpread(360); // 隨機角度
      const phi = THREE.MathUtils.randFloatSpread(360);
      const r = THREE.MathUtils.randFloat(distance * 0.5, distance); // 隨機距離

      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta) + THREE.MathUtils.randFloatSpread(20); // 在 Z 軸上稍微分散

      positions.set([x, y, z], i * 3);
    }
    return positions;
  }, [count]);

  // 隨機速度和旋轉
  const particleData = useMemo(() =>
    Array.from({ length: count }, () => ({
      velocity: new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(0.02), // 較慢的隨機速度
        THREE.MathUtils.randFloatSpread(0.02),
        THREE.MathUtils.randFloatSpread(0.02)
      ),
      rotationSpeed: new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(0.01),
        THREE.MathUtils.randFloatSpread(0.01),
        THREE.MathUtils.randFloatSpread(0.01)
      )
    })),
  [count]);


  useFrame((state, delta) => {
    if (pointsRef.current) {
      const positions = pointsRef.current.geometry.attributes.position.array;
      const distance = 100; // 與上面分佈範圍一致

      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3] += particleData[i].velocity.x * delta * 50; // 應用速度 (乘以 delta 和一個係數調整)
        positions[i3 + 1] += particleData[i].velocity.y * delta * 50;
        positions[i3 + 2] += particleData[i].velocity.z * delta * 50;

        // 邊界檢查：如果粒子移出範圍，則重置到另一側 (簡單環繞效果)
        if (Math.abs(positions[i3]) > distance) positions[i3] *= -0.99;
        if (Math.abs(positions[i3+1]) > distance) positions[i3+1] *= -0.99;
        // Z 軸可以讓它飄遠一點再回來
        if (positions[i3 + 2] > distance * 1.5) positions[i3 + 2] = -distance * 1.5;
        if (positions[i3 + 2] < -distance * 1.5) positions[i3 + 2] = distance * 1.5;

      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;

      // 可以選擇性地加入點的旋轉，但 Points 物件本身不直接支持單獨點旋轉
      // pointsRef.current.rotation.x += delta * 0.001;
      // pointsRef.current.rotation.y += delta * 0.002;
    }
  });

  return (
    <Points ref={pointsRef} positions={particlesPosition} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color="#555555" // 碎片顏色 (暗灰色)
        size={0.08} // 碎片大小 (比星星小)
        sizeAttenuation={true}
        depthWrite={false} // 避免遮擋問題
        blending={THREE.AdditiveBlending} // 混合模式
      />
    </Points>
  );
}


function App() {
  const [isLoading, setIsLoading] = useState(true); // State for loading screen
  const [animateSaturn, setAnimateSaturn] = useState(false);
  const [showMainHtmlContent, setShowMainHtmlContent] = useState(false);
  const [saturnZIndex, setSaturnZIndex] = useState(1);
  const [introVisible, setIntroVisible] = useState(true);
  const introCompleteTimeoutRef = useRef(null);
  const sharedRotationRef = useRef(); // Shared rotation ref
  const [activeSection, setActiveSection] = useState('home'); // State for active section

  // Callback function to update active section
  const handleSectionChange = useCallback((sectionId) => {
    // console.log("Section in view:", sectionId); // For debugging
    setActiveSection(sectionId);
  }, []); // Empty dependency array means this function is created once


  // Handler for when the intro explosion starts
  const handleExplosionStart = () => {
    // console.log(`[App] handleExplosionStart called at ${performance.now().toFixed(0)}ms.`);
    setSaturnZIndex(10000); // Bring Canvas forward during explosion
    // Trigger Saturn animation shortly after explosion starts
    setTimeout(() => {
        // console.log(`[App] Setting animateSaturn=true after delay at ${performance.now().toFixed(0)}ms.`);
        setAnimateSaturn(true);
    }, 200); // Start Saturn animation 200ms after explosion state begins
  };

  // REMOVED handleSingularityShrunk handler

  // Handler for when the intro animation is fully complete
  const handleAnimationComplete = () => {
    // console.log(`[App] handleAnimationComplete called at ${performance.now().toFixed(0)}ms.`); // Log removed
    // setAnimateSaturn(true); // <-- REMOVED: Moved to handleSingularityShrunk
    setShowMainHtmlContent(true);
    setSaturnZIndex(1); // Reset Canvas z-index to background layer

    // Schedule IntroAnimation removal after its fade-out (300ms)
    clearTimeout(introCompleteTimeoutRef.current); // Clear previous timeout if any
    introCompleteTimeoutRef.current = setTimeout(() => {
      setIntroVisible(false);
    }, 300); // Match the fade-out duration
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeout(introCompleteTimeoutRef.current);
    };
  }, []);

  // Effect to handle the initial loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1500); // Show loading screen for 1.5 seconds (adjust as needed)

    return () => clearTimeout(timer); // Cleanup timer on unmount
  }, []);

  // Add fade-out class to loading screen before removing it
  const loadingScreenClass = `loading-screen ${!isLoading ? 'fade-out' : ''}`;

  // Render Loading Screen if isLoading is true
  if (isLoading) {
    return <LoadingScreen />;
    // Or apply the class for fade-out:
    // return <LoadingScreen className={loadingScreenClass} />;
    // Note: The component needs to handle the className prop if using the class approach.
    // The current LoadingScreen.css uses a separate .fade-out class,
    // so we'll just unmount it directly when isLoading is false.
  }

  // Render the main app content when loading is complete
  return (
    <BrowserRouter>
      <ParallaxProvider>
        <div className="App">

          {/* Intro Animation Layer - Conditionally rendered */}
          {introVisible && (
            <IntroAnimation
              onAnimationComplete={handleAnimationComplete}
              onExplosionStart={handleExplosionStart}
            />
          )}

          {/* Removed Dust Band Layer div - effect is now back in .App background */}

          {/* Fixed Canvas Background Layer */}
          <Canvas
            camera={{ position: [0, 0, 5] }} // Move camera further back
            // Canvas is a fixed background, non-interactive
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: saturnZIndex, // Use dynamic z-index state
              pointerEvents: 'none' // Non-interactive background
             }}
          >
            {/* Restore StarfieldScene first */}
            <Suspense fallback={null}>
              {/* 將 sharedRotationRef 傳遞給 StarfieldScene */}
              <StarfieldScene mainStarsRef={sharedRotationRef} />
              <SpaceDebris count={300} /> {/* 加入太空碎片 */}
              {/* Pass animateSaturn prop to Saturn3D */}
              <Saturn3D animate={animateSaturn} />
              {/* 調整渲染順序：將閃爍星星移到土星之後 */}
              <TwinklingStars rotationRef={sharedRotationRef} count={800} />
            </Suspense>
          </Canvas>

          {/* Foreground Stars Layer (Fixed) */}
          <ForegroundStars count={15} /> {/* z-index is 1 (defined in component CSS) */}

          {/* Random Shooting Stars (Fixed Layer) */}
          <RandomShootingStars /> {/* z-index is 4 (defined in component) */}

          {/* Random Comets (Fixed Layer) */}
          <RandomComets /> {/* z-index is 3 (defined in component) */}

          {/* Random UFOs (Fixed Layer) */}
          <RandomUFOs /> {/* z-index is 2 (defined in component) */}

          {/* Removed the duplicate, unconditional main content block */}

          {/* Main Scrollable HTML Content Container - Conditionally rendered based on showMainHtmlContent */}
          {showMainHtmlContent && (
            <div
              className="main-content-container" // Removed animate-in class logic
              style={{ position: 'relative', zIndex: 10 }}
            >
              {/* Pass activeSection to Header */}
              <Header activeSection={activeSection} style={{ position: 'sticky', top: 0, zIndex: 20 }} />
              <main>
                <Routes>
                  {/* Pass onSectionChange callback to MainPage */}
                  <Route path="/" element={<MainPage onSectionChange={handleSectionChange} />} />
                  <Route path="/photos" element={<PhotoGallery />} />
                </Routes>
              </main>
              <Footer style={{ zIndex: 20 }}/>
            </div>
          )}
          {/* Closing curly brace for conditional rendering is back */}

          {/* Cursor Trail (Highest Layer) */}
          <CursorTrail style={{ position: 'fixed', top: 0, left: 0, zIndex: 50, pointerEvents: 'none' }}/>

          {/* Back To Top Button */}
          <BackToTopButton />

        </div>
      </ParallaxProvider>
    </BrowserRouter>
  );
}

export default App;
