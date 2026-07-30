import { useMemo, useCallback, useState, memo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Masonry } from 'masonic';
import { useInView } from 'react-intersection-observer';
import { useSetAtom } from 'jotai';
import { photosAtom, openViewerAtom } from '../store/photoStore';
import PhotoViewer from './PhotoViewer.tsx';
import { loadPhotosManifest } from '../utils/manifestLoader';
import { exifMonthDay, exifYear } from '../lib/exifDate';
import './PhotoGallery.css';
import type { PhotoManifest, MasonryItemType } from '../types/photo';

// 照片項目組件
const PhotoItem = memo(({ data, width, onPhotoClick }: {
  data: PhotoManifest;
  width: number;
  onPhotoClick: (photo: PhotoManifest) => void;
}) => {
  const { ref, inView } = useInView({
    threshold: 0.1,
    triggerOnce: true,
  });

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // 原本是 split(':') 硬切 exiftool 格式；manifest 裡還有 ISO 格式的照片，
  // 那種會切出 "15/00.164Z" 這種東西（見 lib/exifDate 的說明）。
  const displayDate = exifMonthDay(data.exif?.DateTimeOriginal);
  const displayYear = exifYear(data.exif?.DateTimeOriginal);
  const calculatedHeight = width / data.aspectRatio;

  return (
    <motion.div
      ref={ref}
      className="photo-masonry-item group"
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      style={{ width }}
      onClick={() => onPhotoClick(data)}
    >
      <div
        className="photo-card relative overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 cursor-pointer"
        style={{ height: calculatedHeight }}
      >
        {/* 實際圖片 */}
        {inView && !imageError && (
          <img
            src={data.thumbnailUrl}
            alt={data.title}
            className={`photo-image absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        )}

        {/* 錯誤狀態 */}
        {imageError && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">圖片載入失敗</p>
            </div>
          </div>
        )}

        {/* 懸停信息層 */}
        <div className="photo-info-overlay absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
            <p className="photo-date text-2xl font-bold">{displayDate}</p>
            <p className="photo-year text-lg opacity-80">{displayYear}</p>
            {data.tags && data.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {data.tags.slice(0, 5).map((tag) => (
                  <span key={tag} className="px-2 py-1 text-xs bg-white/20 rounded-full backdrop-blur-sm">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

PhotoItem.displayName = 'PhotoItem';

// The tags will be calculated dynamically from the loaded photos

function PhotoGallery() {
  const setPhotosAtom = useSetAtom(photosAtom);
  const openViewer = useSetAtom(openViewerAtom);
  const [photos, setPhotos] = useState<PhotoManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // 靜態與動態計算標籤 (Top 4 + 其他)
  const { topTags, otherTags } = useMemo(() => {
    if (photos.length === 0) return { topTags: [], otherTags: [] };
    const counts: Record<string, number> = {};
    photos.forEach(p => {
      p.tags?.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    // 依出現次數降冪排序；只保留出現 ≥2 次的標籤當篩選
    // （RAM++ 會產生大量只出現一次的標籤，全塞進下拉會爆），整體再上限 24 個
    const FILTER_MAX = 24;
    const sorted = Object.entries(counts)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0]);
    return {
      topTags: sorted.slice(0, 4),
      otherTags: sorted.slice(4, FILTER_MAX)
    };
  }, [photos]);

  // 載入照片資料
  useEffect(() => {
    async function loadPhotos() {
      try {
        setLoading(true);
        const loadedPhotos = await loadPhotosManifest();
        setPhotos(loadedPhotos);
        setPhotosAtom(loadedPhotos);
        setError(null);
      } catch (err) {
        console.error('載入照片失敗:', err);
        setError('載入照片失敗,請稍後再試');
      } finally {
        setLoading(false);
      }
    }

    void loadPhotos();
  }, [setPhotosAtom]);

  // 照片點擊處理
  const handlePhotoClick = useCallback((photo: PhotoManifest) => {
    openViewer(photo);
  }, [openViewer]);

  // 準備 Masonry 數據 (不包含舊版的 HeaderItem)
  const masonryItems: MasonryItemType[] = useMemo(() => {
    let filteredPhotos = photos;
    if (selectedCategory !== '全部') {
      filteredPhotos = photos.filter(photo => photo.tags?.includes(selectedCategory));
    }
    return filteredPhotos;
  }, [photos, selectedCategory]);

  // Masonry 渲染器
  const renderMasonryItem = useCallback(({ data, width }: { data: MasonryItemType; width: number }) => {
    return <PhotoItem data={data as PhotoManifest} width={width} onPhotoClick={handlePhotoClick} />;
  }, [handlePhotoClick]);

  // 載入中狀態
  if (loading) {
    return (
      <section className="photo-gallery-section min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="spinner mb-4 mx-auto"></div>
          <p className="text-lg text-gray-600 dark:text-gray-400">載入照片中...</p>
        </div>
      </section>
    );
  }

  // 錯誤狀態
  if (error) {
    return (
      <section className="photo-gallery-section min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <p className="text-lg text-red-600 dark:text-red-400">{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section id="photo-gallery" className="photo-gallery-section min-h-screen pt-24 pb-20 px-4 lg:px-8">
      {/* Hero 區塊 */}
      <div className="afilmory-hero-container">
        <motion.h1
          className="afilmory-hero-title"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          Afilmory
        </motion.h1>

        <motion.p
          className="afilmory-hero-subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Capturing beautiful moments in life, documenting daily<br />warmth and emotions through my lens.
        </motion.p>

        <motion.div
          className="afilmory-photo-count"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          • {photos.length} photos
        </motion.div>
      </div>

      {/* 分類標籤 */}
      <motion.div
        className="category-tabs-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <div className="category-tabs">
          <button
            className={`category-tab ${selectedCategory === '全部' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('全部')}
          >
            全部
          </button>
          {topTags.map((tab) => (
            <button
              key={tab}
              className={`category-tab ${selectedCategory === tab ? 'active' : ''}`}
              onClick={() => setSelectedCategory(tab)}
            >
              {tab}
            </button>
          ))}
          {otherTags.length > 0 && (
            <div
              className="category-dropdown-container"
              style={{ position: 'relative' }}
              onMouseLeave={() => setDropdownOpen(false)}
            >
              <button
                className={`category-tab ${otherTags.includes(selectedCategory) ? 'active' : ''}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {otherTags.includes(selectedCategory) ? selectedCategory : '更多 ▼'}
              </button>
              {dropdownOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, paddingTop: '0.5rem', zIndex: 50 }}>
                  <div className="category-dropdown-menu" style={{
                    background: 'rgba(30, 30, 40, 0.95)', backdropFilter: 'blur(10px)',
                    borderRadius: '12px', padding: '0.5rem', display: 'flex', flexDirection: 'column',
                    gap: '0.25rem', minWidth: '120px', border: '1px solid rgba(255,255,255,0.1)'
                  }}>
                    {otherTags.map(tab => (
                      <button
                        key={tab}
                        style={{
                          padding: '0.5rem 1rem', background: 'transparent',
                          color: selectedCategory === tab ? '#fff' : 'rgba(255,255,255,0.7)',
                          textAlign: 'left', borderRadius: '8px', border: 'none', cursor: 'pointer',
                          backgroundColor: selectedCategory === tab ? 'rgba(127, 90, 240, 0.3)' : 'transparent',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategory(tab);
                          setDropdownOpen(false);
                        }}
                        // onFocus/onBlur 與 hover 鏡像：原本只有滑鼠會有反白，
                        // 鍵盤 Tab 過來完全看不出停在哪一項。
                        onMouseOver={(e) => {
                          if (selectedCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onFocus={(e) => {
                          if (selectedCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (selectedCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                        onBlur={(e) => {
                          if (selectedCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Masonry 瀑布流佈局 */}
      <div className="masonry-container max-w-7xl mx-auto">
        <Masonry
          key={selectedCategory}
          items={masonryItems}
          render={renderMasonryItem}
          columnWidth={300}
          columnGutter={16}
          rowGutter={16}
          overscanBy={2}
        />
      </div>



      {/* 照片查看器 */}
      <PhotoViewer />
    </section>
  );
}

export default PhotoGallery;