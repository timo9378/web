import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './RandomUFOs.css'; // 導入 UFO 的 CSS
import { usePageVisibility } from '../contexts/pageVisibility';

const getRandomValue = (min: number, max: number) => Math.random() * (max - min) + min;

interface UFO {
  id: number;
  startX: string;
  startY: string;
  keyframesX: number[];
  keyframesY: number[];
  duration: number;
  delay: number;
  scale: number;
}

// 創建 UFO 數據 - 加入更多隨機移動點
const createUFO = (): UFO => {
  const duration = getRandomValue(20, 40); // 增加持續時間，更慢更飄
  const startX = getRandomValue(10, 90);
  const startY = getRandomValue(10, 90);
  const scale = getRandomValue(0.6, 1.1);

  // 生成多個隨機位移點，用於 keyframe 動畫
  const keyframesX = [0]; // 初始相對位置 X
  const keyframesY = [0]; // 初始相對位置 Y
  const numKeyframes = 4; // 設定 4 個移動階段 (可以調整)
  const maxMove = 80; // 每個階段最大移動距離

  for (let i = 1; i <= numKeyframes; i++) {
    // 累加隨機位移，讓它看起來更像漂浮
    keyframesX.push(keyframesX[i - 1] + getRandomValue(-maxMove, maxMove));
    keyframesY.push(keyframesY[i - 1] + getRandomValue(-maxMove / 2, maxMove / 2)); // 垂直移動幅度小一點
  }
  // 最後回到起點附近，形成循環感 (可選)
  // keyframesX.push(getRandomValue(-20, 20));
  // keyframesY.push(getRandomValue(-10, 10));


  return {
    id: Math.random(),
    startX: `${startX}%`,
    startY: `${startY}%`,
    keyframesX: keyframesX,
    keyframesY: keyframesY,
    duration: duration,
    delay: getRandomValue(5, 25),
    scale: scale
  };
};

interface RandomUFOsProps {
  count?: number;
}

const RandomUFOs = ({ count = 1 }: RandomUFOsProps) => { // UFO 數量減少為 1
  const { isVisible } = usePageVisibility();
  const [ufos, setUfos] = useState<UFO[]>(() =>
    Array.from({ length: count }, createUFO)
  );

  useEffect(() => {
    // 如果頁面不可見，不啟動 UFO 動畫
    if (!isVisible) {
      console.log('RandomUFOs: 已暫停 (頁面不可見)');
      return;
    }

    // 不再檢查 isVisible：effect 開頭已經 `if (!isVisible) return`，而 isVisible 在
    // 依賴陣列裡——值一變 effect 就整個重掛，同一次執行內它恆為 true。
    const interval = setInterval(() => {
      setUfos(prevUfos => {
        const newUfos = [...prevUfos];
        const randomIndex = Math.floor(Math.random() * newUfos.length);
        newUfos[randomIndex] = createUFO();
        newUfos[randomIndex].delay = getRandomValue(10, 30); // 確保較長延遲
        return newUfos;
      });
    }, 25000); // 每 25 秒嘗試更新一個 UFO (頻率更低)

    return () => { clearInterval(interval); };
  }, [count, isVisible]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 2, // 比彗星和流星更低層 (最遠)
      overflow: 'hidden',
    }}>
      <AnimatePresence>
        {ufos.map(ufo => (
          <motion.div
            key={ufo.id}
            className="ufo" // 使用 CSS class
            style={{
              left: ufo.startX,
              top: ufo.startY,
            }}
            initial={{
              opacity: 0,
              scale: ufo.scale * 0.5, // 初始縮小一點
              x: ufo.keyframesX[0], // 初始相對位置
              y: ufo.keyframesY[0]
            }}
            animate={isVisible ? {
              x: ufo.keyframesX, // 使用 keyframes 陣列進行動畫
              y: ufo.keyframesY,
              opacity: [0, 0.7, 0.7, 0.7, 0.7, 0], // 調整透明度變化以匹配 keyframes
              scale: ufo.scale, // 可以簡化 scale 動畫，或也用 keyframes
            } : {}}
            transition={{
              delay: ufo.delay,
              duration: isVisible ? ufo.duration : 0,
              ease: "easeInOut",
              // times 陣列需要與 keyframes 陣列長度匹配 (或省略讓 framer-motion 自動分配)
              // opacity: { duration: ufo.duration, times: [0, 0.1, 0.4, 0.6, 0.9, 1] },
              opacity: { duration: isVisible ? ufo.duration : 0, ease: "linear" }, // 簡化 opacity 過渡
              x: { duration: isVisible ? ufo.duration : 0, ease: "easeInOut" }, // 確保位移動畫平滑
              y: { duration: isVisible ? ufo.duration : 0, ease: "easeInOut" },
              // repeat: Infinity, // 可以讓它無限循環
              // repeatType: "mirror", // 來回播放
            }}
            exit={{ opacity: 0, scale: 0, transition: { duration: 0.5, delay: 0 } }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default RandomUFOs;
