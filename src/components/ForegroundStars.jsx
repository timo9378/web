import React, { useState, useEffect, useRef } from 'react';
import './ForegroundStars.css';

const ForegroundStars = ({ count = 10 }) => {
  const [stars, setStars] = useState([]);
  const containerRef = useRef(null);

  // 初始化星星
  useEffect(() => {
    const newStars = [];
    for (let i = 0; i < count; i++) {
      newStars.push({
        id: i,
        x: Math.random() * 100, // %
        y: Math.random() * 100, // %
        size: Math.random() * 2.5 + 1.5, // 1.5px to 4px
        brightness: Math.random() * 0.5 + 0.5, // 0.5 to 1.0
        parallaxFactor: Math.random() * 0.03 + 0.01, // 0.01 to 0.04 (adjust for sensitivity)
      });
    }
    setStars(newStars);
  }, [count]);

  // 處理滑鼠移動以實現視差效果
  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!containerRef.current) return;

      const { clientWidth, clientHeight } = containerRef.current;
      // 計算滑鼠相對於容器中心的位置 (-0.5 to 0.5)
      const mouseX = (event.clientX / clientWidth) - 0.5;
      const mouseY = (event.clientY / clientHeight) - 0.5;

      // 更新星星位置
      setStars(prevStars =>
        prevStars.map(star => {
          // 移動方向與滑鼠相反，幅度由 parallaxFactor 決定
          const offsetX = -mouseX * star.parallaxFactor * 100; // Convert factor to percentage offset
          const offsetY = -mouseY * star.parallaxFactor * 100;

          return {
            ...star,
            transform: `translate(${offsetX}%, ${offsetY}%)`,
          };
        })
      );
    };

    const currentRef = containerRef.current; // Capture ref value
    if (currentRef) {
        // Attach listener to the container itself or window
        window.addEventListener('mousemove', handleMouseMove);
    }


    return () => {
      if (currentRef) {
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <div className="foreground-stars-container" ref={containerRef}>
      {stars.map(star => (
        <div
          key={star.id}
          className="foreground-star"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.brightness,
            transform: star.transform || 'translate(0, 0)', // Apply transform for parallax
            // Glow effect is now handled by CSS
          }}
        />
      ))}
    </div>
  );
};

export default ForegroundStars;
