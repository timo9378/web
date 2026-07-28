import { useState, useEffect, useCallback, useRef, useMemo, type ImgHTMLAttributes } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes } from 'react-icons/fa';
import { thumbHashToDataURL, thumbHashToApproximateAspectRatio } from 'thumbhash';

/**
 * 圖片 Lightbox 組件
 * - 點擊放大圖片（浮動在頁面正中央）
 * - 滾動立即關閉（不 preventDefault，不卡頓）
 * - NAS 圖片 hover 顯示完整 EXIF 資訊（從 manifest 讀取）
 */

interface ExifData {
  make?: string;
  model?: string;
  LensModel?: string;
  FNumber?: number | string;
  ISO?: number | null;
  ExposureTime?: number | string;
  FocalLength?: number | string;
  FocalLengthIn35mmFormat?: string;
}

interface Photo {
  thumbnailUrl?: string;
  originalUrl?: string;
  urls?: { thumb?: string; full?: string };
  exif?: ExifData;
}

/* ── NAS manifest 快取 ── */
let _manifestCache: Map<string, Photo> | null = null;
let _manifestLoading = false;
let _manifestCallbacks: ((map: Map<string, Photo>) => void)[] = [];

const fetchManifest = (): Promise<Map<string, Photo>> => {
  if (_manifestCache) return Promise.resolve(_manifestCache);
  if (_manifestLoading) {
    return new Promise<Map<string, Photo>>((resolve) => { _manifestCallbacks.push(resolve); });
  }
  _manifestLoading = true;
  return fetch('/api/gallery/photos')
    .then((r) => (r.ok ? r.json() as Promise<{ photos?: Photo[] } | null> : null))
    .then((data) => {
      if (data?.photos) {
        // 建立 URL → photo 的快速查詢 map
        const map = new Map<string, Photo>();
        data.photos.forEach((p) => {
          if (p.thumbnailUrl) map.set(p.thumbnailUrl, p);
          if (p.originalUrl) map.set(p.originalUrl, p);
          if (p.urls?.thumb) map.set(p.urls.thumb, p);
          if (p.urls?.full) map.set(p.urls.full, p);
        });
        _manifestCache = map;
      } else {
        _manifestCache = new Map();
      }
      // 透過區域變數傳給 callback，不用 _manifestCache!：模組層級的 let 在 TS 眼中
      // 隨時可能被別處改掉，賦值後的窄化不會留到閉包裡，只好靠斷言。改綁區域值就沒這問題。
      const ready = _manifestCache;
      _manifestCallbacks.forEach((cb) => cb(ready));
      _manifestCallbacks = [];
      return ready;
    })
    .catch(() => {
      const empty = new Map<string, Photo>();
      _manifestCache = empty;
      _manifestCallbacks.forEach((cb) => cb(empty));
      _manifestCallbacks = [];
      return empty;
    });
};

// 判斷是否為 NAS 圖片
const isNASImage = (src?: string): boolean => !!src && src.includes('/nas-images/');

// 取得 NAS 高解析度 URL（thumbnail → 原圖）
const getNASHighResUrl = (src?: string): string | undefined => {
  if (!src) return src;
  // -thumb.webp → .webp (高解析度也是 webp 格式)
  return src.replace(/-thumb\.webp$/, '.webp');
};

// 取得內文用的顯示 URL（thumbnail → 高解析度，讓文章內圖片清晰）
const getNASDisplayUrl = (src?: string): string | undefined => {
  if (!src || !isNASImage(src)) return src;
  // 如果是 thumbnail，改用高解析度版本
  if (src.includes('-thumb.webp')) {
    return src.replace(/-thumb\.webp$/, '.webp');
  }
  return src;
};

interface ThumbPlaceholder { dataUrl: string; aspectRatio: number }

/**
 * 從圖片 URL 的 #th=<base64url> fragment 解出 thumbhash，
 * 回傳 { dataUrl, aspectRatio } 供模糊佔位使用。沒 fragment 或解析失敗回 null。
 *
 * 後端 (server/index.js 的 /admin/upload) 上傳時會把 thumbhash 編進 URL fragment，
 * 瀏覽器送 HTTP 請求時不會帶 fragment，所以對 nginx 快取無影響。
 */
const decodeThumbHashFromSrc = (src?: string): ThumbPlaceholder | null => {
  if (!src) return null;
  const m = /#th=([A-Za-z0-9_-]+)/.exec(src);
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - b64.length % 4) % 4);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {
      dataUrl: thumbHashToDataURL(bytes),
      aspectRatio: thumbHashToApproximateAspectRatio(bytes),
    };
  } catch {
    return null;
  }
};

type BlogImageProps = { src?: string; alt?: string } & ImgHTMLAttributes<HTMLImageElement>;

// 獨立的圖片包裝組件
export const BlogImage = ({ src, alt, ...props }: BlogImageProps) => {
  const [showLightbox, setShowLightbox] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [exifData, setExifData] = useState<ExifData | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const isNAS = isNASImage(src);

  // 內文顯示用高解析度
  const displaySrc = getNASDisplayUrl(src);
  // 點擊放大用原圖
  const fullSrc = isNAS ? getNASHighResUrl(src) : src;

  // 從 URL #th= fragment 解 thumbhash（後端 /admin/upload 寫入），
  // 拿來做模糊佔位 + 用近似 aspect ratio 預留版面避免 CLS。
  const placeholder = useMemo(() => decodeThumbHashFromSrc(src), [src]);

  // 載入 EXIF 資訊
  useEffect(() => {
    if (!isNAS) return;
    void fetchManifest().then((map) => {
      if (!src) return;
      // 嘗試用 thumbnail URL 或高解析度 URL 查詢
      const photo = map.get(src) ?? map.get(getNASHighResUrl(src) ?? '');
      if (photo?.exif) setExifData(photo.exif);
    });
  }, [src, isNAS]);

  // 判斷 EXIF 是否有足夠資訊顯示（至少要有拍攝參數或相機/鏡頭資訊）
  const hasExifContent = exifData != null && (
    exifData.make != null || exifData.model != null || exifData.LensModel != null ||
    exifData.FNumber != null || exifData.ISO != null || exifData.ExposureTime != null ||
    exifData.FocalLength != null || exifData.FocalLengthIn35mmFormat != null
  );
  // 只有日期 → 不顯示 EXIF overlay（避免只顯示一個 📅 日期很奇怪）
  const showExif = isNAS && showInfo && hasExifContent;

  // 相機資訊：優先 make+model，fallback 到 LensModel
  const cameraLabel = exifData
    ? ((exifData.make && exifData.model)
      ? `${exifData.make} ${exifData.model}`
      : (exifData.model ?? ''))
    : '';

  // 鏡頭資訊：去除與相機名稱重複的部分
  const lensLabel = (() => {
    if (!exifData?.LensModel) return '';
    const lens = exifData.LensModel;
    // 如果 LensModel 完全等於 cameraLabel → 重複，不顯示
    if (lens === cameraLabel) return '';
    if (!cameraLabel) return lens;
    const lensLower = lens.toLowerCase();
    const camLower = cameraLabel.toLowerCase();
    // 如果 LensModel 包含相機型號名稱（如 "Pixel 8 Pro back camera"） → 不顯示
    if (lensLower.includes(camLower)) return '';
    // 如果相機名稱包含鏡頭名稱 → 重複，不顯示
    if (camLower.includes(lensLower)) return '';
    return lens;
  })();

  return (
    <>
      <span
        className="blog-image-wrapper"
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
      >
        <img
          {...props}
          src={displaySrc}
          alt={alt ?? ''}
          onClick={() => setShowLightbox(true)}
          onLoad={() => setImgLoaded(true)}
          className={`blog-image-clickable${placeholder && !imgLoaded ? ' blog-image-loading' : ''}`}
          loading="lazy"
          decoding="async"
          style={placeholder ? {
            ...(props.style ?? {}),
            backgroundImage: `url(${placeholder.dataUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            aspectRatio: placeholder.aspectRatio,
          } : props.style}
        />
        {/* NAS 圖片 hover overlay — 顯示完整 EXIF（從下滑入） */}
        {isNAS && exifData && hasExifContent && (
          <span className={`blog-image-exif${showExif ? ' blog-image-exif--visible' : ''}`}>
            {cameraLabel && <span>📷 {cameraLabel}</span>}
            {lensLabel && <span>🔍 {lensLabel}</span>}
            {exifData.FNumber && <span>ƒ/{exifData.FNumber}</span>}
            {exifData.ISO != null && <span>ISO {exifData.ISO}</span>}
            {exifData.ExposureTime && <span>{exifData.ExposureTime}s</span>}
            {(exifData.FocalLength ?? exifData.FocalLengthIn35mmFormat) != null && <span>{exifData.FocalLengthIn35mmFormat ? `${exifData.FocalLengthIn35mmFormat.replace(' mm', 'mm')}` : exifData.FocalLength}</span>}
          </span>
        )}
      </span>
      {showLightbox && (
        <ImageLightbox src={fullSrc} alt={alt} onClose={() => setShowLightbox(false)} />
      )}
    </>
  );
};

interface ImageLightboxProps {
  src?: string;
  alt?: string;
  onClose: () => void;
}

// Lightbox 主組件 — 使用 Portal 渲染到 body
function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const closingRef = useRef(false);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    // 滾動立即關閉 — 不 preventDefault，不會卡頓
    const handleWheel = () => handleClose();
    const handleScroll = () => handleClose();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  // 用 Portal 渲染到 body，確保 fixed 定位在全頁面正中央
  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        className="image-lightbox-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={handleClose}
      >
        <motion.img
          src={src}
          alt={alt ?? ''}
          className="image-lightbox-img"
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
        />
        <button className="image-lightbox-close" onClick={handleClose}>
          <FaTimes />
        </button>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default ImageLightbox;
