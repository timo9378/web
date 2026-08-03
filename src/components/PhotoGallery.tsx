import { useMemo, useCallback, useState, memo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Masonry } from 'masonic';
import { useInView } from 'react-intersection-observer';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { photosAtom, openViewerAtom } from '../store/photoStore';
import PhotoViewer from './PhotoViewer.tsx';
import { loadPhotosManifest } from '../utils/manifestLoader';
import { exifMonthDay, exifYear } from '../lib/exifDate';
import './PhotoGallery.css';
import type { PhotoManifest, MasonryItemType } from '../types/photo';

/**
 * 這張照片在目前語系下該顯示哪一組標籤。
 *
 * manifest 兩組都有（`tags` 中文、`tagsEn` 英文，RAM++ 產的），但這個元件原本
 * **完全沒有 i18n**——不管哪個語系都直接讀 `tags`，所以 /en/photos 與 /ja/photos
 * 的篩選鈕一直是「全部／坐／男人／地板／貓」，而周圍的介面文字（More／もっと）
 * 明明是翻好的。資料早就在，只是從來沒被接上。
 *
 * ja/ko 沒有對應語系的標籤資料，退到英文而不是留中文：英文至少是明確的，
 * 而中文標籤對日韓讀者是「看得懂字但不是自己的語言」的半吊子狀態。
 * 真要有 ja/ko 標籤得重跑一次自動標註，那是另一件事。
 */
function tagsFor(photo: Pick<PhotoManifest, 'tags' | 'tagsEn'>, locale: string): string[] {
  const useChinese = locale === 'zh-TW' || locale === 'zh-CN';
  if (useChinese) return photo.tags ?? [];
  const en = photo.tagsEn ?? [];
  return en.length > 0 ? en : (photo.tags ?? []); // 沒有英文標籤的照片就維持原樣
}

// 照片項目組件
const PhotoItem = memo(({ data, width, locale, onPhotoClick }: {
  data: PhotoManifest;
  width: number;
  /** 懸停時顯示的標籤也要跟著語系走，不然卡片上仍是中文 */
  locale: string;
  onPhotoClick: (photo: PhotoManifest) => void;
}) => {
  const shownTags = tagsFor(data, locale);
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
            {shownTags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {shownTags.slice(0, 5).map((tag) => (
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

/** 「全部」在內部當作沒有篩選的哨兵值；顯示文字走 i18n，不要拿顯示字串當狀態。 */
const ALL_TAGS = '__all__';

function PhotoGallery() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const setPhotosAtom = useSetAtom(photosAtom);
  const openViewer = useSetAtom(openViewerAtom);
  const [photos, setPhotos] = useState<PhotoManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_TAGS);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // 靜態與動態計算標籤 (Top 4 + 其他)
  const { topTags, otherTags } = useMemo(() => {
    if (photos.length === 0) return { topTags: [], otherTags: [] };
    const counts: Record<string, number> = {};
    photos.forEach(p => {
      tagsFor(p, locale).forEach(t => {
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
  }, [photos, locale]);

  // 換語系時標籤整組換掉（中文 → 英文），先前選的那個在新語系裡不存在。
  // 用**推導**而不是在 effect 裡 setState：後者會多一次 render，而且中間那一幀
  // 是「選了一個不存在的標籤」＝畫面空白。這裡直接把失效的選擇視同「全部」。
  const activeCategory =
    selectedCategory !== ALL_TAGS &&
    !topTags.includes(selectedCategory) &&
    !otherTags.includes(selectedCategory)
      ? ALL_TAGS
      : selectedCategory;

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
    if (activeCategory !== ALL_TAGS) {
      // 用 tagsFor 而不是 photo.tags：選單顯示的是該語系的標籤，
      // 這裡若拿中文去比對，非中文語系會篩出空結果。
      filteredPhotos = photos.filter(photo => tagsFor(photo, locale).includes(activeCategory));
    }
    return filteredPhotos;
  }, [photos, activeCategory, locale]);

  // Masonry 渲染器
  const renderMasonryItem = useCallback(({ data, width }: { data: MasonryItemType; width: number }) => {
    return <PhotoItem data={data as PhotoManifest} width={width} locale={locale} onPhotoClick={handlePhotoClick} />;
  }, [handlePhotoClick, locale]);

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
            className={`category-tab ${activeCategory === ALL_TAGS ? 'active' : ''}`}
            onClick={() => setSelectedCategory(ALL_TAGS)}
          >
            {t('gallery.allTags')}
          </button>
          {topTags.map((tab) => (
            <button
              key={tab}
              className={`category-tab ${activeCategory === tab ? 'active' : ''}`}
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
                className={`category-tab ${otherTags.includes(activeCategory) ? 'active' : ''}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {otherTags.includes(activeCategory) ? activeCategory : `${t('gallery.moreTags')} ▼`}
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
                          color: activeCategory === tab ? '#fff' : 'rgba(255,255,255,0.7)',
                          textAlign: 'left', borderRadius: '8px', border: 'none', cursor: 'pointer',
                          backgroundColor: activeCategory === tab ? 'rgba(127, 90, 240, 0.3)' : 'transparent',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategory(tab);
                          setDropdownOpen(false);
                        }}
                        // onFocus/onBlur 與 hover 鏡像：原本只有滑鼠會有反白，
                        // 鍵盤 Tab 過來完全看不出停在哪一項。
                        onMouseOver={(e) => {
                          if (activeCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onFocus={(e) => {
                          if (activeCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (activeCategory !== tab) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                        onBlur={(e) => {
                          if (activeCategory !== tab) {
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
          key={activeCategory}
          items={masonryItems}
          render={renderMasonryItem}
          columnWidth={300}
          columnGutter={16}
          rowGutter={16}
          overscanBy={2}
          // ⚠ 一定要指定 role。masonic 預設 role="grid"，而它給子項的是 role="gridcell"
          //   （見 use-masonry：list→listitem、grid→gridcell），中間**不產** role="row"。
          //   gridcell 依規格必須被 row 包住，所以預設值出來的是一個結構壞掉的 grid：
          //   讀屏軟體會找不到列、整個瀑布流變成無法瀏覽的一團。Lighthouse 的
          //   aria-required-children / aria-required-parent 兩條都會紅（/photos 0.90）。
          //   相簿本來就是清單語意，改成 list 之後子項變 listitem，不需要中間層。
          //
          //   prefer-tag-over-role 會建議改用 <ul>。masonic 支援 `as`/`itemAs`，
          //   但換成 ul/li 會帶進清單的預設 padding 與項目符號，得再寫一組 CSS 去消——
          //   為了一個「寫法偏好」的規則動版面不划算，而無障礙的結果一模一樣。
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="list"
        />
      </div>



      {/* 照片查看器 */}
      <PhotoViewer />
    </section>
  );
}

export default PhotoGallery;