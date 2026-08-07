import { useState, useEffect, useCallback, useRef, useMemo, type ImgHTMLAttributes } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes } from 'react-icons/fa';
import { thumbHashToDataURL, thumbHashToApproximateAspectRatio } from 'thumbhash';

/**
 * `BlogImage` — 文章內文的 `<img>` 渲染器（ReactMarkdown / MDX 的 `img` 元件）。
 * - 從 URL 的 `#th=…&w=…&h=…` fragment 解出 thumbhash 佔位圖與原始尺寸（防 CLS）
 * - 點擊放大：下方的 `ImageLightbox` modal（浮在正中央、滾動立即關閉）
 * - NAS 圖片 hover 顯示完整 EXIF（從 manifest 讀取）
 *
 * ⚠ 這個檔原本叫 `gallery/ImageLightbox.tsx`，但它**跟照片牆沒有任何關係**：
 * 唯一的 export 是 `BlogImage`，呼叫端只有 `blog/BlogPost.tsx` 與 `admin/PostPreview.tsx`
 * （後台預覽要跟前台同一套渲染），`gallery/` 底下零個。照片牆自己的燈箱是 `PhotoViewer.tsx`。
 * 元件依「實際 import 圖」分組（見 CLAUDE.md），所以它屬於 `blog/`；
 * 檔名也跟著改成 export 的名字，`ImageLightbox` 留給檔案內部那個 modal。
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
 * 從圖片 URL 的 fragment 解出上傳時寫進去的原始像素尺寸（`#th=…&w=1142&h=724`）。
 *
 * ⚠ 這是文章頁 CLS 的解藥，不是效能微調。`.blog-image-wrapper` 是
 * `width: fit-content`——寬度取決於圖片的固有尺寸，而圖還沒載入時固有寬度是 **0**，
 * 於是 `aspect-ratio` 反推出來的高度也是 0，整個盒子塌掉；等圖載入才撐開，
 * 底下的內容就整片位移。thumbhash 佔位圖救不了，因為盒子早就塌了。
 *
 * 實測（2026-08-07 正式站 /blog/why-i-switched-to-zed）：
 *   冷啟動（scrollY=0）  CLS 0.0000  ← 圖在畫面外，位移不計入
 *   捲到 4000px 後重整   CLS 0.3362  ← 四個 <p> 從 0px 長到 432/216/186/101
 * 最小重現：只有 aspect-ratio → 高 19px；補上 width/height → 高 653px。
 *
 * ⚠ 不能改用 `thumbHashToApproximateAspectRatio` 代替：那是**近似值**
 * （1142×724 解出 1.75、704×85 解出 7），而且比例本身救不了「寬度為 0」——
 * 要先有確定的寬度，aspect-ratio 才反推得出高度。
 *
 * 舊文章的網址沒有 w/h（那是 2026-08 才加的），回 null → 退回原本只有
 * aspect-ratio 的行為，不會比現在更糟。
 */
const decodeSizeFromSrc = (src?: string): { width: number; height: number } | null => {
  if (!src) return null;
  const w = /[#&]w=(\d+)/.exec(src);
  const h = /[#&]h=(\d+)/.exec(src);
  if (!w || !h) return null;
  const width = Number(w[1]);
  const height = Number(h[1]);
  // 0 或 NaN 比沒有更糟：width="0" 會讓瀏覽器把圖片壓成 0 寬
  return width > 0 && height > 0 ? { width, height } : null;
};

/**
 * 從圖片 URL 的 #th=<base64url> fragment 解出 thumbhash，
 * 回傳 { dataUrl, aspectRatio } 供模糊佔位使用。沒 fragment 或解析失敗回 null。
 *
 * 後端 (`/admin/upload`) 上傳時會把 thumbhash 編進 URL fragment，
 * 瀏覽器送 HTTP 請求時不會帶 fragment，所以對 nginx 快取無影響。
 *
 * ⚠ 這條 regex 到 `&` 為止（`[A-Za-z0-9_-]+` 不含 `&`），所以後面接 `&w=&h=`
 * 不會把尺寸吃進 hash——舊網址與新網址走同一條路。
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

  // 從 URL #th= fragment 解 thumbhash（後端 /admin/upload 寫入），拿來做模糊佔位。
  const placeholder = useMemo(() => decodeThumbHashFromSrc(src), [src]);
  // 原始尺寸（同一個 fragment 的 &w= &h=）。真正預留版面的是這個，不是 aspect-ratio
  // ——理由見 decodeSizeFromSrc 的註解。
  const size = useMemo(() => decodeSizeFromSrc(src), [src]);

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
        {/* 圖片包一層 <button>：原本 onClick 直接掛在 <img> 上，那既不可聚焦、
            也沒有鍵盤操作，報讀器更不會提示它可以按開大圖。 */}
        <button
          type="button"
          className="blog-image-zoom"
          onClick={() => setShowLightbox(true)}
          aria-label={alt ? `放大檢視：${alt}` : '放大檢視圖片'}
        >
        <img
          {...props}
          src={displaySrc}
          alt={alt ?? ''}
          // ⚠ 這兩個屬性是版面預留的唯一來源（見 decodeSizeFromSrc）。
          // CSS 的 `max-width:100%; height:auto` 照樣負責縮放，屬性只是讓瀏覽器
          // 在圖片載入**之前**就知道要留多高。舊文章沒有 w/h 時退回 undefined，
          // 行為與這次修正前相同。
          width={size?.width}
          height={size?.height}
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
        </button>
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
