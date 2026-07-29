/**
 * PhotoViewer - 全螢幕照片查看器 (Afilmory 風格)
 * 支援 Swiper 輪播、模糊背景、底部縮圖導覽、右側 EXIF 面板
 */

import { useState, useEffect, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard, Thumbs } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import {
  selectedPhotoAtom,
  viewerOpenAtom,
  closeViewerAtom,
  photosAtom,
  currentIndexAtom,
} from '../store/photoStore';
import type { PhotoManifest } from '../types/photo';
import ProgressiveImage from './ProgressiveImage';
import GalleryThumbnail from './GalleryThumbnail';
import EXIFPanel from './EXIFPanel';
import 'swiper/css';
import 'swiper/css/navigation';
import './PhotoViewer.css';

const PhotoViewer: React.FC = () => {
  const isOpen = useAtomValue(viewerOpenAtom);
  const selectedPhoto = useAtomValue(selectedPhotoAtom);
  const photos = useAtomValue(photosAtom);
  const [currentIndex, setCurrentIndex] = useAtom(currentIndexAtom);
  const closeViewer = useSetAtom(closeViewerAtom);

  const [thumbsSwiper, setThumbsSwiper] = useState<SwiperType | null>(null);
  const [mainSwiper, setMainSwiper] = useState<SwiperType | null>(null);
  const [imageScale, setImageScale] = useState(1);

  // 鍵盤快捷鍵（原生實作，取代 react-use 的 useKey — 整包只用到這一個 hook）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeViewer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeViewer]);

  // Callback for ProgressiveImage to report its scale
  const handleScaleChange = useCallback((scale: number) => {
    setImageScale(scale);
  }, []);

  // Lock swiper when image is zoomed
  useEffect(() => {
    if (mainSwiper) {
      mainSwiper.allowTouchMove = imageScale <= 1;
    }
  }, [imageScale, mainSwiper]);

  // 重置狀態當檢視器關閉。
  // thumbsSwiper / mainSwiper 是 Swiper 透過 onSwiper callback 回傳的實例，只能在
  // 生命週期裡收；關閉時整個 overlay 已 unmount（見下方 isOpen && currentPhoto），
  // 使用者看不到重設前的畫面。這裡是「丟掉失效的外部實例」，不是可推導的衍生值。
  /* eslint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) {
      setThumbsSwiper(null);
      setMainSwiper(null);
      setImageScale(1); // Reset scale state
    }
  }, [isOpen]);
  /* eslint-enable @eslint-react/set-state-in-effect */

  // 當前照片是純衍生值：索引有效時取該張，否則沿用開啟時選中的那張。
  // 原本用 useEffect + setState，等於每次換頁都先繪一次舊照片、effect 再補繪。
  // 用明確的邊界檢查而非 photos[i] ?? fallback：沒開 noUncheckedIndexedAccess 時
  // TS 把 photos[i] 當成必然存在，?? 會被判成多餘——但執行期越界就是 undefined。
  // 這裡的條件與原本 effect 裡的守衛一字對應。
  const currentPhoto: PhotoManifest | undefined =
    currentIndex >= 0 && currentIndex < photos.length
      ? photos[currentIndex]
      : (selectedPhoto ?? undefined);

  // 初始化 Swiper 索引
  useEffect(() => {
    if (isOpen && mainSwiper && selectedPhoto) {
      const index = photos.findIndex((p) => p.id === selectedPhoto.id);
      if (index !== -1) {
        mainSwiper.slideTo(index, 0);
        setCurrentIndex(index);
      }
    }
  }, [isOpen, mainSwiper, selectedPhoto, photos, setCurrentIndex]);

  // 處理 Swiper 滑動
  const handleSlideChange = (swiper: SwiperType) => {
    setCurrentIndex(swiper.activeIndex);
    setImageScale(1); // Reset zoom on slide change
  };

  // 處理縮圖點擊
  const handleThumbnailClick = (index: number) => {
    mainSwiper?.slideTo(index);
  };

  return (
    <AnimatePresence>
      {isOpen && currentPhoto && (
        <motion.div
          className="photo-viewer-overlay"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* 模糊背景 */}
          <div
            className="photo-viewer-background"
            style={{
              backgroundImage: `url(${currentPhoto.urls.thumb || currentPhoto.urls.small})`,
            }}
          />

          {/* 頂部照片資訊 */}
          {/* 沒有 onClick 了：外層 .photo-viewer-overlay 本來就沒掛點擊關閉，
              這裡的 stopPropagation 沒有任何冒泡可擋，是死碼 */}
          <div className="photo-viewer-info">
            <div className="photo-title">
              照片 {currentPhoto.exif?.DateTimeOriginal ?? currentPhoto.title}
            </div>
          </div>

          {/* 右上角按鈕組 */}
          <div className="viewer-top-right-buttons">
            {/* 分享按鈕 */}
            <button
              className="action-btn action-btn-share"
              aria-label="分享這張照片"
              onClick={(e) => {
                e.stopPropagation();
                // lib.dom 把 Web Share API 宣告成必然存在，桌面 Firefox 實際沒有。
                // 必須留在 nav 上呼叫：Navigator 不是 [Global] 介面，解構後會 Illegal invocation。
                const nav: Partial<Navigator> = navigator;
                if (nav.share) {
                  nav.share({
                    title: currentPhoto.title || '照片分享',
                    text: `查看我的照片作品`,
                    url: window.location.href,
                  }).catch(() => { /* 使用者取消分享 */ });
                }
              }}
              title="分享"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>

            {/* 關閉按鈕 */}
            <button
              className="action-btn action-btn-close"
              aria-label="關閉檢視器"
              onClick={(e) => {
                e.stopPropagation();
                closeViewer();
              }}
              title="關閉 (ESC)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* 縮放比例顯示 */}
          {imageScale > 1 && (
            <div className="zoom-indicator">
              {imageScale.toFixed(1)}x
            </div>
          )}

          {/* 主圖輪播區域 */}
          <div className="photo-viewer-main">
            {/* 自訂導航按鈕 - 上一張 */}
            <button aria-label="上一張照片" className="custom-swiper-button-prev" onClick={(e) => e.stopPropagation()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button aria-label="下一張照片" className="custom-swiper-button-next" onClick={(e) => e.stopPropagation()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <Swiper
              onSwiper={setMainSwiper}
              spaceBetween={10}
              navigation={{
                prevEl: '.custom-swiper-button-prev',
                nextEl: '.custom-swiper-button-next',
              }}
              keyboard={{
                enabled: true,
              }}
              thumbs={thumbsSwiper && !thumbsSwiper.destroyed ? { swiper: thumbsSwiper } : undefined}
              modules={[Navigation, Keyboard, Thumbs]}
              onSlideChange={handleSlideChange}
              className="main-swiper"
            >
              {photos.map((photo, index) => {
                // Only render ProgressiveImage if it's close to the current view
                const shouldRender = Math.abs(index - currentIndex) <= 2;
                return (
                  <SwiperSlide key={photo.id}>
                    <div className="swiper-zoom-container">
                      {shouldRender ? (
                        <ProgressiveImage
                          src={photo.urls.regular || photo.urls.full}
                          thumbSrc={photo.urls.thumb || photo.urls.small}
                          alt={photo.title || ''}
                          thumbHash={photo.thumbHash ?? undefined}
                          isCurrentImage={index === currentIndex}
                          onScaleChange={handleScaleChange}
                          enableZoom={true}
                          enablePan={true}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%' }} />
                      )}
                    </div>
                  </SwiperSlide>
                );
              })}
            </Swiper>
          </div>

          {/* 底部縮圖導覽列 */}
          <GalleryThumbnail
            photos={photos}
            activeIndex={currentIndex}
            onThumbnailClick={handleThumbnailClick}
            thumbsSwiper={thumbsSwiper}
            onSwiper={setThumbsSwiper}
          />

          {/* 右側 EXIF 資訊面板 - 常駐顯示 */}
          <EXIFPanel photo={currentPhoto} />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PhotoViewer;
