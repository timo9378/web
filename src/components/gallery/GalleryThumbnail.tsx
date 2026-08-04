/**
 * GalleryThumbnail - 底部縮圖導覽列
 * 使用 Swiper 實現橫向滾動
 */

import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode, Navigation, Thumbs } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import type { PhotoManifest } from '@/types/photo';
import 'swiper/css';
import 'swiper/css/free-mode';
import 'swiper/css/navigation';
import 'swiper/css/thumbs';
import './GalleryThumbnail.css';

interface GalleryThumbnailProps {
  photos: PhotoManifest[];
  activeIndex: number;
  onThumbnailClick: (index: number) => void;
  thumbsSwiper: SwiperType | null;
  onSwiper: (swiper: SwiperType) => void;
}

const GalleryThumbnail: React.FC<GalleryThumbnailProps> = ({
  photos,
  activeIndex,
  onThumbnailClick,
  onSwiper,
}) => {
  return (
    <div className="gallery-thumbnail-container">
      <Swiper
        onSwiper={onSwiper}
        spaceBetween={12}
        slidesPerView="auto"
        freeMode={true}
        watchSlidesProgress={true}
        modules={[FreeMode, Navigation, Thumbs]}
        className="gallery-thumbnail-swiper"
      >
        {photos.map((photo, index) => (
          <SwiperSlide key={photo.id} className="gallery-thumbnail-slide">
            {/* 選擇這張縮圖（原本是可點的 div：不可聚焦、無鍵盤操作，報讀器也不知道它能按） */}
            <button
              type="button"
              className={`gallery-thumbnail-item ${index === activeIndex ? 'active' : ''
                }`}
              onClick={() => onThumbnailClick(index)}
            >
              <img
                src={photo.urls.thumb || photo.urls.small}
                alt={photo.title || ''}
                loading="lazy"
              />
              {index === activeIndex && <div className="active-indicator" />}
            </button>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default GalleryThumbnail;
