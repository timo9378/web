import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import './ProgressiveImage.css';

interface ProgressiveImageProps {
  src: string;
  thumbSrc?: string;
  alt?: string;
  thumbHash?: string;
  onLoad?: () => void;
  className?: string;
  enablePan?: boolean;
  enableZoom?: boolean;
  onScaleChange?: (scale: number) => void;
  isCurrentImage?: boolean; // Only the active slide should have zoom enabled
}

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  thumbSrc,
  alt = '',
  onLoad,
  className = '',
  enablePan = true,
  enableZoom = true,
  onScaleChange,
  isCurrentImage,
}) => {
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  // Report scale change
  useEffect(() => {
    if (onScaleChange) {
      onScaleChange(scale);
    }
  }, [scale, onScaleChange]);

  // Reset state when image source changes or it's no longer the current image.
  // 刻意留在 effect：!isCurrentImage 代表這張已經不是當前 slide（PhotoViewer 只渲染
  // currentIndex ±2），使用者看不到重設前的那一幀，沒有「render 期調整」的必要。
  // 試過改寫成官方的 prev-props 比較法，反而多一個警告（規則會把 render 期的
  // setState 也報成 in-an-effect），程式碼也更繞。
  /* eslint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    if (!isCurrentImage) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [src, isCurrentImage]);
  /* eslint-enable @eslint-react/set-state-in-effect */


  // Preload high-res image only when it's the current image
  useEffect(() => {
    // Only start loading if it's the current image and it hasn't loaded yet.
    if (isCurrentImage && !loaded) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        setLoaded(true);
        onLoad?.();
      };
    }
    // Do not reset 'loaded' state when isCurrentImage becomes false
    // to keep already loaded images in high-res when swiping back.
  }, [src, onLoad, isCurrentImage, loaded]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!enableZoom || !isCurrentImage) return;
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    setScale(prevScale => {
      const newScale = Math.max(1, Math.min(prevScale + delta, 5));
      if (newScale === 1) {
        setPosition({ x: 0, y: 0 });
      }
      return newScale;
    });
  }, [enableZoom, isCurrentImage]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enablePan || scale <= 1 || !isCurrentImage) return;
    e.preventDefault();
    setIsPanning(true);
    setStartPos({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [enablePan, scale, isCurrentImage, position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning || !containerRef.current) return;

    const newX = e.clientX - startPos.x;
    const newY = e.clientY - startPos.y;

    // Boundary checks to prevent panning too far
    const container = containerRef.current;
    const image = imageRef.current;
    if (container && image) {
      const containerRect = container.getBoundingClientRect();
      const imageWidth = image.naturalWidth * scale;
      const imageHeight = image.naturalHeight * scale;

      // Calculate how much the image exceeds the container
      const excessWidth = Math.max(0, (imageWidth - containerRect.width) / 2);
      const excessHeight = Math.max(0, (imageHeight - containerRect.height) / 2);

      // Only clamp if the image is larger than the container in that dimension
      const clampedX = excessWidth > 0
        ? Math.max(-excessWidth, Math.min(newX, excessWidth))
        : 0; // Keep centered if image is smaller

      const clampedY = excessHeight > 0
        ? Math.max(-excessHeight, Math.min(newY, excessHeight))
        : 0; // Keep centered if image is smaller

      setPosition({ x: clampedX, y: clampedY });
    } else {
      setPosition({ x: newX, y: newY });
    }

  }, [isPanning, startPos, scale]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container && isCurrentImage) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        container.removeEventListener('wheel', handleWheel);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [handleWheel, handleMouseMove, handleMouseUp, isCurrentImage]);


  return (
    <div
      ref={containerRef}
      className={`progressive-image-wrapper ${className}`}
      onMouseDown={handleMouseDown}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : (isCurrentImage && scale > 1 ? 'grab' : 'default'),
      }}
    >
      <motion.div
        className="progressive-image-panner"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          scale,
          translateX: position.x,
          translateY: position.y,
          transformOrigin: 'center center',
        }}
      >
        {/* Thumbnail */}
        {thumbSrc && (
          <motion.img
            src={thumbSrc}
            alt={alt}
            className="progressive-image-thumb"
            initial={{ opacity: 1 }}
            animate={{ opacity: loaded ? 0 : 1 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'absolute',
              maxWidth: '100%',
              maxHeight: '100%',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              filter: 'blur(10px)',
            }}
          />
        )}

        {/* Full-res image */}
        <motion.img
          ref={imageRef}
          src={src}
          alt={alt}
          className="progressive-image-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: loaded ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          draggable={false}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
          }}
        />
      </motion.div>

      {/* Loading indicator */}
      {!loaded && (
        <div className="progressive-image-loader">
          <div className="spinner" />
        </div>
      )}
    </div>
  );
};

export default ProgressiveImage;