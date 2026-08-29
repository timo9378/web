/**
 * Image Processor
 * 照片處理器 - 生成縮圖、高解析度圖片、ThumbHash
 */

import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { BuilderConfig } from './config';

export interface ProcessedImage {
  thumbnailPath: string;
  thumbnailUrl: string;
  highResPath: string;
  highResUrl: string;
  thumbHash?: string;
  width: number;
  height: number;
  size: number;
  format: string;
}

/**
 * 處理單張照片
 */
export async function processImage(
  inputPath: string,
  outputDir = '/mnt/hdd16tb_01/nas-storage/gallery', // Default to NAS path
  config: BuilderConfig,
): Promise<ProcessedImage> {
  const fileName = path.basename(inputPath, path.extname(inputPath));

  // 確保輸出目錄存在
  await fs.mkdir(outputDir, { recursive: true });

  // URL Base for NAS
  const urlBase = '/nas-images';

  // 讀取原始圖片
  let image = sharp(inputPath);
  const metadata = await image.metadata();

  // 處理 HEIC 格式
  if (inputPath.toLowerCase().endsWith('.heic')) {
    // Sharp 本身支援 HEIC,但可能需要額外配置
    console.log(`📸 處理 HEIC 格式: ${fileName}`);
  }

  // 自動旋轉 (根據 EXIF Orientation)
  image = image.rotate();

  // 尺寸取「旋轉後」的實際值：EXIF orientation 5~8 為 90°/270° 旋轉、會交換寬高。
  // 用旋轉前的 metadata 會讓直式照片 manifest 的 aspectRatio 顛倒 → 瀑布流版面錯位。
  const swapWH = (metadata.orientation ?? 1) >= 5;
  const originalWidth = (swapWH ? metadata.height : metadata.width) || 0;
  const originalHeight = (swapWH ? metadata.width : metadata.height) || 0;

  // 1. 生成縮圖
  const thumbnailFileName = `${fileName}-thumb.${config.processing.thumbnail.format}`;
  const thumbnailPath = path.join(outputDir, thumbnailFileName);

  // 輸出格式由 config 決定（webp/jpeg…），用動態方法呼叫；先落成變數，
  // 避免 `})` 換行後接 `[...]` 被誤讀成陣列（no-unexpected-multiline）。
  const thumbPipeline = image.clone().resize(config.processing.thumbnail.width, null, {
    withoutEnlargement: true,
    fit: 'inside',
  });
  await thumbPipeline[config.processing.thumbnail.format]({
    quality: config.processing.thumbnail.quality,
  }).toFile(thumbnailPath);

  console.log(`✅ 縮圖生成: ${thumbnailFileName}`);

  // 2. 生成高解析度圖片
  const highResFileName = `${fileName}.${config.processing.highRes.format}`;
  const highResPath = path.join(outputDir, highResFileName);

  const highResPipeline = image.clone().resize(config.processing.highRes.maxWidth, null, {
    withoutEnlargement: true,
    fit: 'inside',
  });
  const highResInfo = await highResPipeline[config.processing.highRes.format]({
    quality: config.processing.highRes.quality,
  }).toFile(highResPath);

  console.log(`✅ 高解析度圖片生成: ${highResFileName}`);

  // 3. 生成 ThumbHash
  let thumbHash: string | undefined;

  if (config.processing.enableThumbHash) {
    try {
      // 生成極小的圖片用於 ThumbHash
      const thumbHashImage = await image
        .clone()
        .resize(100, 100, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { data, info } = thumbHashImage;
      const hash = rgbaToThumbHash(info.width, info.height, data);
      thumbHash = Buffer.from(hash).toString('base64');

      console.log(`✅ ThumbHash 生成: ${fileName}`);
    } catch (error) {
      console.error(`❌ ThumbHash 生成失敗: ${fileName}`, error);
    }
  }

  return {
    thumbnailPath,
    thumbnailUrl: `${urlBase}/${thumbnailFileName}`,
    highResPath,
    highResUrl: `${urlBase}/${highResFileName}`,
    thumbHash,
    width: originalWidth,
    height: originalHeight,
    // 輸出 webp 的實際大小（原本誤填輸入原檔的 stats.size）
    size: highResInfo.size,
    format: metadata.format || 'unknown',
  };
}

/**
 * 支援的圖片格式
 */
export const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif'];

/**
 * 檢查檔案是否為支援的圖片格式
 */
export function isSupportedImageFormat(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_FORMATS.includes(ext);
}
