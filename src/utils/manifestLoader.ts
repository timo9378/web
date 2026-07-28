/// <reference types="vite/client" />
/**
 * Photo Manifest Loader
 * 載入照片 manifest 資料
 */

import type { PhotoManifest } from '../types/photo';

export interface PhotosManifestData {
  version: string;
  generatedAt: string;
  totalPhotos: number;
  photos: PhotoManifest[];
}

/**
 * 從 public/photos-manifest.json 載入照片資料
 */
export async function loadPhotosManifest(): Promise<PhotoManifest[]> {
  try {
    // API endpoint for NAS Gallery
    const response = await fetch('/api/gallery/photos');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as PhotosManifestData;

    console.log(`✅ 載入 ${data.totalPhotos} 張照片`);
    console.log(`📅 生成時間: ${data.generatedAt}`);

    return data.photos;
  } catch (error) {
    console.error('❌ 載入 photos-manifest.json 失敗:', error);

    // 如果 manifest 不存在,回退到使用本地圖片
    console.warn('⚠️  回退到本地圖片模式');
    return loadLocalPhotos();
  }
}

/**
 * 回退方案: 使用 Vite 的 import.meta.glob 載入本地圖片
 */
function loadLocalPhotos(): PhotoManifest[] {
  const imageModules = import.meta.glob('../assets/Portfolio/*.{webp,jpg,jpeg,png,gif,svg}', {
    eager: true
  });

  return Object.entries(imageModules).map(([path, module], index) => {
    // 用 at(-1) ?? '' 取代 pop()!：split 對非空字串必有元素，但那是人腦知道、
    // 型別系統不知道，用斷言等於把「我確定」寫進程式碼裡而不是讓它自然成立。
    const fileName = (path.split('/').at(-1) ?? '').split('.')[0];
    const imageUrl = (module as { default: string }).default;

    let shootTime: number | undefined;
    let title = fileName;

    // 嘗試從檔名提取日期
    const dateMatch = /^(\d{4})(\d{2})(\d{2})/.exec(fileName);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      shootTime = new Date(`${year}-${month}-${day}`).getTime();
      title = `照片 ${year}/${month}/${day}`;
    }

    return {
      id: `local-photo-${index}`,
      title,
      description: '本地照片',
      urls: {
        full: imageUrl,
        regular: imageUrl,
        small: imageUrl,
        thumb: imageUrl,
      },
      originalUrl: imageUrl,
      thumbnailUrl: imageUrl,
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      size: 0,
      format: path.split('.').pop()?.toLowerCase() ?? 'jpg',
      shootTime,
      exif: dateMatch ? {
        DateTimeOriginal: `${dateMatch[1]}:${dateMatch[2]}:${dateMatch[3]} 00:00:00`,
      } : undefined,
      tags: [],
    };
  });
}

/**
 * 取得圖片格式
 */
export function getImageFormat(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase() ?? '';
  return ext.toUpperCase();
}

/**
 * 檢查是否為 Live Photo
 */
export function isLivePhoto(photo: PhotoManifest): boolean {
  return photo.isLivePhoto === true && !!photo.livePhotoVideoUrl;
}
