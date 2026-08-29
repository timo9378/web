import React, { useRef, useState, useMemo, Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, useTexture, Html, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { a, useSpring } from '@react-spring/three';
import * as THREE from 'three';
import { useTranslation } from 'react-i18next';
import './ZeroGravityLibrary.css';

interface Book {
  id: string | number;
  title: string;
  coverUrl?: string;
  authors?: string[];
  description?: string;
  publishedDate?: string;
  pageCount?: number;
}

// 自訂拖動 Hook - 修復版本
function useDragObject() {
  const [isDragging, setIsDragging] = useState(false);
  const { camera, gl } = useThree();
  const dragPlaneRef = useRef(new THREE.Plane());
  const offsetRef = useRef(new THREE.Vector3());
  const intersectionRef = useRef(new THREE.Vector3());
  const currentPositionRef = useRef(new THREE.Vector3());

  const bind = useMemo(() => {
    const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();

      // 保存當前位置
      currentPositionRef.current.copy(e.object.position);

      // 設定拖動平面 (平行於相機視角)
      const cameraDirection = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(cameraDirection, currentPositionRef.current);

      // 計算點擊點與物體中心的偏移
      dragPlaneRef.current.projectPoint(e.point, intersectionRef.current);
      offsetRef.current.copy(intersectionRef.current).sub(currentPositionRef.current);

      setIsDragging(true);
      gl.domElement.style.cursor = 'grabbing';
    };

    const onPointerUp = (_e: ThreeEvent<PointerEvent>) => {
      setIsDragging(false);
      gl.domElement.style.cursor = 'grab';
    };

    return {
      onPointerDown,
      onPointerUp,
    };
  }, [camera, gl]);

  return { ...bind, isDragging };
}

interface Book3DProps {
  book: Book;
  initialPosition: [number, number, number];
  onClick: () => void;
  isSelected: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

// 單本 3D 書籍組件 (有封面) - 支援拖動
function Book3DWithTexture({ book, initialPosition, onClick, isSelected, onDragStateChange }: Book3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState(initialPosition);
  const { onPointerDown, onPointerUp, isDragging } = useDragObject();
  const { camera, raycaster } = useThree();

  const dragPlaneRef = useRef(new THREE.Plane());
  const offsetRef = useRef(new THREE.Vector3());

  // 通知父組件拖動狀態改變
  useEffect(() => {
    if (onDragStateChange) {
      onDragStateChange(isDragging);
    }
  }, [isDragging, onDragStateChange]);

  // 建立指向後端代理的 URL,解決 CORS 問題
  const originalUrl = book.coverUrl ?? '';
  const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;

  // 使用代理 URL 載入貼圖
  const texture = useTexture(proxyUrl, (tex) => {
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
  });

  // 書本漂浮動畫 (拖動時停用)
  useFrame((state) => {
    if (groupRef.current && meshRef.current && !isDragging && !isSelected) {
      meshRef.current.rotation.y += 0.002;
      const floatY = Math.sin(state.clock.elapsedTime + position[0]) * 0.1;
      groupRef.current.position.y = position[1] + floatY;
    }

    // 拖動時更新位置
    if (isDragging && groupRef.current) {
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersection);
      groupRef.current.position.copy(intersection.sub(offsetRef.current));
    }
  });

  // 處理按下
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();

    if (groupRef.current) {
      // 設定拖動平面
      const cameraDirection = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(cameraDirection, groupRef.current.position);

      // 計算偏移
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersection);
      offsetRef.current.copy(intersection).sub(groupRef.current.position);
    }

    onPointerDown(e);
  };

  // 處理釋放
  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging && groupRef.current) {
      // 保存新位置
      const p = groupRef.current.position;
      setPosition([p.x, p.y, p.z]);
    }
    onPointerUp(e);
  };

  // 處理點擊
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isDragging) {
      e.stopPropagation();
      onClick();
    }
  };

  // 書本尺寸
  const bookWidth = 0.8;
  const bookHeight = 1.2;
  const bookDepth = 0.15;

  // 縮放動畫
  const { scale } = useSpring({
    scale: isSelected ? 1.5 : hovered ? 1.15 : 1,
    config: { tension: 280, friction: 60 },
  });

  return (
    <a.group
      ref={groupRef}
      position={position}
      scale={scale}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerOver={() => !isDragging && setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* 書本主體 */}
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[bookWidth, bookHeight, bookDepth]} />
        <meshStandardMaterial map={texture} metalness={0.2} roughness={0.6} />
      </mesh>

      {/* 光暈效果 */}
      {(hovered || isSelected || isDragging) && (
        <pointLight
          color={isDragging ? '#fbbf24' : isSelected ? '#c4b5fd' : '#7f5af0'}
          intensity={isDragging ? 3 : isSelected ? 2 : 1}
          distance={3}
        />
      )}

      {/* 書名標籤 */}
      {(hovered || isDragging) && !isSelected && (
        <Html
          position={[0, bookHeight / 2 + 0.3, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div className="book-label">
            {book.title}
            {isDragging && <div style={{ fontSize: '0.7em', marginTop: '2px' }}>拖動中...</div>}
          </div>
        </Html>
      )}
    </a.group>
  );
}

// 單本 3D 書籍組件 (無封面 - 純色) - 支援拖動
function Book3DNoTexture({ book, initialPosition, onClick, isSelected, onDragStateChange }: Book3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState(initialPosition);
  const { onPointerDown, onPointerUp, isDragging } = useDragObject();
  const { camera, raycaster } = useThree();

  const dragPlaneRef = useRef(new THREE.Plane());
  const offsetRef = useRef(new THREE.Vector3());

  // 通知父組件拖動狀態改變
  useEffect(() => {
    if (onDragStateChange) {
      onDragStateChange(isDragging);
    }
  }, [isDragging, onDragStateChange]);

  // 書本漂浮動畫 (拖動時停用)
  useFrame((state) => {
    if (groupRef.current && meshRef.current && !isDragging && !isSelected) {
      meshRef.current.rotation.y += 0.002;
      const floatY = Math.sin(state.clock.elapsedTime + position[0]) * 0.1;
      groupRef.current.position.y = position[1] + floatY;
    }

    // 拖動時更新位置
    if (isDragging && groupRef.current) {
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersection);
      groupRef.current.position.copy(intersection.sub(offsetRef.current));
    }
  });

  // 處理按下
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();

    if (groupRef.current) {
      // 設定拖動平面
      const cameraDirection = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(cameraDirection, groupRef.current.position);

      // 計算偏移
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlaneRef.current, intersection);
      offsetRef.current.copy(intersection).sub(groupRef.current.position);
    }

    onPointerDown(e);
  };

  // 處理釋放
  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging && groupRef.current) {
      // 保存新位置
      const p = groupRef.current.position;
      setPosition([p.x, p.y, p.z]);
    }
    onPointerUp(e);
  };

  // 處理點擊
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isDragging) {
      e.stopPropagation();
      onClick();
    }
  };

  // 書本尺寸
  const bookWidth = 0.8;
  const bookHeight = 1.2;
  const bookDepth = 0.15;

  // 縮放動畫
  const { scale } = useSpring({
    scale: isSelected ? 1.5 : hovered ? 1.15 : 1,
    config: { tension: 280, friction: 60 },
  });

  return (
    <a.group
      ref={groupRef}
      position={position}
      scale={scale}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerOver={() => !isDragging && setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* 書本主體 */}
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[bookWidth, bookHeight, bookDepth]} />
        <meshStandardMaterial
          color="#7f5af0"
          metalness={0.5}
          roughness={0.3}
          emissive="#7f5af0"
          emissiveIntensity={0.4}
          toneMapped={false}
        />
      </mesh>

      {/* 光暈效果 */}
      {(hovered || isSelected || isDragging) && (
        <pointLight
          color={isDragging ? '#fbbf24' : isSelected ? '#c4b5fd' : '#7f5af0'}
          intensity={isDragging ? 3 : isSelected ? 2 : 1}
          distance={3}
        />
      )}

      {/* 書名標籤 */}
      {(hovered || isDragging) && !isSelected && (
        <Html
          position={[0, bookHeight / 2 + 0.3, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div className="book-label">
            {book.title}
            {isDragging && <div style={{ fontSize: '0.7em', marginTop: '2px' }}>拖動中...</div>}
          </div>
        </Html>
      )}
    </a.group>
  );
}

// 包裝組件 - 根據是否有封面選擇組件
function Book3D({ book, initialPosition, onClick, isSelected, onDragStateChange }: Book3DProps) {
  // 如果書本有 coverUrl，就使用有材質的版本，否則使用純色版
  if (book.coverUrl) {
    return (
      <Book3DWithTexture
        book={book}
        initialPosition={initialPosition}
        onClick={onClick}
        isSelected={isSelected}
        onDragStateChange={onDragStateChange}
      />
    );
  }

  // 如果沒有封面 URL，則顯示純色版本作為備用
  return (
    <Book3DNoTexture
      book={book}
      initialPosition={initialPosition}
      onClick={onClick}
      isSelected={isSelected}
      onDragStateChange={onDragStateChange}
    />
  );
}

// ── Shaders ──
const diskVertexShader = `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const diskFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vPos;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += noise(p) * a;
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float r = length(vPos.xy);
    float angle = atan(vPos.y, vPos.x);
    float innerR = 1.8, outerR = 5.0;
    float nr = clamp((r - innerR) / (outerR - innerR), 0.0, 1.0);

    // Keplerian differential rotation — faster speed for visible motion
    float omega = 0.8 / pow(max(r, 0.5), 1.5);

    // Multi-layer streaming for visible spiral structure
    float a1 = angle + uTime * omega;
    float a2 = angle + uTime * omega * 0.7;
    vec2 nc1 = vec2(a1 * 3.0, r * 4.0);
    vec2 nc2 = vec2(a2 * 2.0 + 3.14, r * 2.5);
    float n = fbm(nc1) * 0.65 + fbm(nc2) * 0.35;

    // Spiral arm structure
    float spiralAngle = angle + log(max(r, 0.1)) * 2.0 - uTime * 0.3;
    float spiral = pow(0.5 + 0.5 * sin(spiralAngle * 3.0), 2.0);
    n = n * (0.6 + 0.4 * spiral);

    // Temperature-based color — warmer palette
    float temp = pow(1.0 - nr, 0.7);
    vec3 hot  = vec3(1.0, 0.95, 0.8);
    vec3 warm = vec3(1.0, 0.5, 0.08);
    vec3 cool = vec3(0.7, 0.15, 0.04);
    vec3 cold = vec3(0.12, 0.02, 0.05);
    vec3 color = mix(cold, cool, smoothstep(0.0, 0.3, temp));
    color = mix(color, warm, smoothstep(0.3, 0.6, temp));
    color = mix(color, hot, smoothstep(0.6, 1.0, temp));

    // Smooth radial fade — wider inner fade to avoid hard inner edge
    float radial = smoothstep(0.0, 0.2, nr) * smoothstep(1.0, 0.7, nr);

    // Doppler beaming — one side brighter
    float doppler = 1.0 + 0.4 * sin(angle - uTime * 0.2);
    float brightness = (n * 0.55 + 0.45) * radial * doppler * 2.5;

    gl_FragColor = vec4(color * brightness, brightness * 0.85);
  }
`;

// 知識黑洞 — event horizon + accretion disk
function KnowledgeBlackHole() {
  const diskRef = useRef<THREE.Mesh>(null);
  const uniformsRef = useRef({ uTime: { value: 0 } });

  useFrame((state) => {
    uniformsRef.current.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      {/* Event horizon — pure black sphere, meshBasicMaterial ignores all lighting and bloom */}
      <mesh renderOrder={10}>
        <sphereGeometry args={[1.4, 64, 64]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>

      {/* Accretion disk — procedural shader, high segment count for smooth ring */}
      <mesh ref={diskRef} rotation={[Math.PI / 2.15, 0, 0]} renderOrder={5}>
        <ringGeometry args={[1.8, 5.0, 256, 32]} />
        <shaderMaterial
          vertexShader={diskVertexShader}
          fragmentShader={diskFragmentShader}
          uniforms={uniformsRef.current}
          transparent
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Thin photon ring — sharp bright line at ISCO */}
      <mesh rotation={[Math.PI / 2.15, 0, 0]} renderOrder={6}>
        <torusGeometry args={[1.55, 0.015, 16, 256]} />
        <meshBasicMaterial color="#ffcc66" transparent opacity={0.6} toneMapped={false} />
      </mesh>

      {/* Warm accent lights for books, NOT hitting the black sphere */}
      <pointLight color="#ff8833" intensity={1.5} distance={15} />
      <pointLight color="#fbbf24" intensity={1} distance={8} />
    </group>
  );
}

interface SceneProps {
  books: Book[];
  onBookClick: (book: Book) => void;
  selectedBook: Book | null;
}

// 3D 場景內容
function Scene({ books, onBookClick, selectedBook }: SceneProps) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const draggingBooksRef = useRef(new Set<Book['id']>());
  const [isDraggingAnyBook, setIsDraggingAnyBook] = useState(false);

  // 處理書籍拖動狀態變化
  const handleBookDragStateChange = (bookId: Book['id'], isDragging: boolean) => {
    if (isDragging) {
      draggingBooksRef.current.add(bookId);
    } else {
      draggingBooksRef.current.delete(bookId);
    }

    // 只要有任何一本書在拖動,就禁用 OrbitControls
    setIsDraggingAnyBook(draggingBooksRef.current.size > 0);
  };

  // 將書籍排列成多個環形軌道
  const booksPerRing = 12;
  const numberOfRings = Math.ceil(books.length / booksPerRing);

  const bookPositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    books.forEach((_, index) => {
      const ringIndex = Math.floor(index / booksPerRing);
      const positionInRing = index % booksPerRing;
      const angle = (positionInRing / booksPerRing) * Math.PI * 2;

      // 半徑隨著環數增加
      const radius = 8 + ringIndex * 3;
      const x = Math.cos(angle) * radius;
      const y = (ringIndex - numberOfRings / 2) * 2.5;
      const z = Math.sin(angle) * radius;

      positions.push([x, y, z]);
    });
    return positions;
  }, [books, booksPerRing, numberOfRings]);

  return (
    <>
      {/* 環境光 — 確保場景基礎可見度 */}
      <ambientLight intensity={1.2} />

      {/* 主光源 — 多方向確保書籍可見 */}
      <directionalLight position={[10, 10, 5]} intensity={1.2} />
      <directionalLight position={[-10, -5, -5]} intensity={0.6} />
      <directionalLight position={[0, -10, 10]} intensity={0.4} />

      {/* 外圍環境光 — 照亮書籍軌道區域 */}
      <pointLight position={[0, 8, 0]} intensity={1} distance={60} decay={1} />
      <pointLight position={[0, -8, 0]} intensity={0.6} distance={60} decay={1} />

      {/* 背景星空 */}
      <Stars radius={300} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

      {/* 知識黑洞 */}
      <KnowledgeBlackHole />

      {/* 書籍陣列 */}
      {books.map((book, index) => (
        <Book3D
          key={book.id}
          book={book}
          initialPosition={bookPositions[index]}
          onClick={() => onBookClick(book)}
          isSelected={selectedBook?.id === book.id}
          onDragStateChange={(dragging) => handleBookDragStateChange(book.id, dragging)}
        />
      ))}

      {/* 相機控制 */}
      <OrbitControls
        ref={controlsRef}
        enabled={!isDraggingAnyBook}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={50}
        makeDefault
      />

      {/* Post-processing: Bloom */}
      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.3} intensity={0.8} radius={0.4} mipmapBlur />
      </EffectComposer>
    </>
  );
}

interface ZeroGravityLibraryProps {
  books?: Book[];
  onClose: () => void;
}

// 主組件
export default function ZeroGravityLibrary({ books = [], onClose }: ZeroGravityLibraryProps) {
  const { t } = useTranslation();
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const hints = t('bookshelf.zg.hint').split(' · ');

  return (
    <div className="zero-gravity-container">
      <Canvas
        camera={{ position: [0, 5, 20], fov: 60 }}
        className="zero-gravity-canvas"
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
      >
        <Suspense fallback={null}>
          <Scene books={books} onBookClick={setSelectedBook} selectedBook={selectedBook} />
        </Suspense>
      </Canvas>

      {/* Overlay UI */}
      <div className="zg-overlay">
        {/* Top bar */}
        <div className="zg-top-bar">
          <div className="zg-brand">
            <span className="zg-brand-title">Knowledge Black Hole</span>
            <span className="zg-brand-sub">{books.length} books in orbit</span>
          </div>
          <button className="zg-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {t('bookshelf.zg.back')}
          </button>
        </div>

        {/* Controls hint — bottom center */}
        <div className="zg-hints">
          {hints.map((h, i) => (
            <React.Fragment key={h}>
              {i > 0 && <span className="zg-hint-dot" />}
              <span>{h}</span>
            </React.Fragment>
          ))}
        </div>

        {/* Book details panel */}
        {selectedBook && (
          <div className="zg-detail-panel">
            <button className="zg-detail-close" aria-label="關閉書籍詳情" onClick={() => setSelectedBook(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            {selectedBook.coverUrl && (
              <img src={selectedBook.coverUrl} alt={selectedBook.title} className="zg-detail-cover" />
            )}
            <h3 className="zg-detail-title">{selectedBook.title}</h3>
            {(selectedBook.authors?.length ?? 0) > 0 && (
              <p className="zg-detail-author">{selectedBook.authors?.join(', ')}</p>
            )}
            {selectedBook.description && <p className="zg-detail-desc">{selectedBook.description}</p>}
            <div className="zg-detail-meta">
              {selectedBook.publishedDate && <span>{selectedBook.publishedDate}</span>}
              {selectedBook.pageCount && <span>{selectedBook.pageCount} 頁</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
