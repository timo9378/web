import React, { useRef, useMemo } from 'react';
import { Points, PointMaterial } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function TwinklingStars({ count = 800, rotationRef }) {
  const pointsRef = useRef();
  const materialRef = useRef();

  // 隨機生成星星位置
  const particlesPosition = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const radius = 100; // 與 StarfieldScene 保持一致的半徑

    for (let i = 0; i < count; i++) {
      // 使用球體坐標生成均勻分佈的點
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u; // Azimuthal angle
      const phi = Math.acos(2 * v - 1); // Polar angle
      const r = radius * Math.cbrt(Math.random()); // Cube root distribution for volume

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions.set([x, y, z], i * 3);
    }
    return positions;
  }, [count]);

  // 隨機化每個點的閃爍偏移和速度
  const twinkleData = useMemo(() =>
    Array.from({ length: count }, () => ({
      offset: Math.random() * 2 * Math.PI, // 隨機起始相位
      speed: THREE.MathUtils.randFloat(0.3, 0.8), // 隨機閃爍速度
      minOpacity: 0.3, // 最小透明度
      maxOpacity: 0.8, // 最大透明度 (不要太亮)
    })),
  [count]);

  useFrame(({ clock }) => {
    const elapsedTime = clock.getElapsedTime();

    if (materialRef.current) {
      // 整體材質透明度變化模擬閃爍 - 較簡單但效果可能不夠自然
      // materialRef.current.opacity = 0.5 + Math.sin(elapsedTime * 0.5) * 0.2;

      // 注意：PointMaterial 不直接支持單獨點的透明度控制。
      // 要實現單獨點閃爍，需要更複雜的 ShaderMaterial。
      // 作為折衷，我們可以讓整體透明度有一個非常明顯的波動來測試。
      materialRef.current.opacity = 0.5 + Math.sin(elapsedTime * 1.0) * 0.5; // 更快的速度，更大的範圍 (0.0 to 1.0)
    }

    // 如果傳入了 rotationRef，則同步旋轉
    if (pointsRef.current && rotationRef?.current) {
        pointsRef.current.rotation.copy(rotationRef.current.rotation);
    } else if (pointsRef.current) {
        // 否則，給一個默認的慢速旋轉
        pointsRef.current.rotation.x += 0.0001;
        pointsRef.current.rotation.y += 0.0002;
    }
  });

  return (
    <Points ref={pointsRef} positions={particlesPosition} stride={3} frustumCulled={false}>
      <PointMaterial
        ref={materialRef}
        transparent
        color="#ffffff" // 星星顏色 (白色)
        size={0.2} // 大幅增加尺寸以便觀察
        sizeAttenuation={true}
        depthWrite={false} // <--- 恢復為 false
        blending={THREE.NormalBlending} // 保持 NormalBlending
        opacity={1.0} // 設置最高基礎透明度
      />
    </Points>
  );
}

export default TwinklingStars;
