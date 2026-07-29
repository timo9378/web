/**
 * Photo Builder - 照片處理構建器
 * 掃描照片、處理圖片、提取 EXIF、生成 manifest.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { BuilderConfig } from './config';
import { loadConfig } from './config';
import { extractExif } from './exif-extractor';
import { processImage, isSupportedImageFormat } from './image-processor';
import type { PhotoManifest } from '../../src/types/photo';

interface BuildStats {
  total: number;
  processed: number;
  failed: number;
  skipped: number;
  startTime: number;
  endTime?: number;
}

/**
 * 掃描目錄下的所有圖片
 */
async function scanPhotos(sourcePath: string, excludeRegex?: string): Promise<string[]> {
  const photos: string[] = [];
  const excludePattern = excludeRegex ? new RegExp(excludeRegex) : null;

  async function scan(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // 檢查是否排除
      if (excludePattern && excludePattern.test(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && isSupportedImageFormat(entry.name)) {
        photos.push(fullPath);
      }
    }
  }

  await scan(sourcePath);
  return photos;
}

/**
 * 處理單張照片並生成 PhotoManifest
 */
async function processPhoto(
  inputPath: string,
  outputDir: string,
  config: BuilderConfig,
  index: number
): Promise<PhotoManifest | null> {
  try {
    const fileName = path.basename(inputPath);
    console.log(`\n📷 [${index}] 處理中: ${fileName}`);

    // 1. 提取 EXIF
    console.log('  📋 提取 EXIF...');
    const exifData = await extractExif(inputPath);

    // 2. 處理圖片
    console.log('  🖼️  處理圖片...');
    const processedImage = await processImage(inputPath, outputDir, config);

    // 3. 生成 PhotoManifest
    const photoId = path.basename(inputPath, path.extname(inputPath));

    // 從檔名或 EXIF 提取日期
    let shootTime: number | undefined;
    let title = fileName;

    // 嘗試從檔名提取日期 (YYYYMMDD 格式)
    const dateMatch = fileName.match(/^(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      shootTime = new Date(`${year}-${month}-${day}`).getTime();
      title = `照片 ${year}/${month}/${day}`;
    } else if (exifData.dateTimeOriginal) {
      // 從 EXIF 提取日期
      const exifDate = exifData.dateTimeOriginal.replace(/:/g, '-').split(' ')[0];
      shootTime = new Date(exifDate).getTime();
    }

    const manifest: PhotoManifest = {
      id: photoId,
      title,
      description: `${exifData.make || ''} ${exifData.model || ''}`.trim(),

      urls: {
        full: processedImage.highResUrl,
        regular: processedImage.highResUrl,
        small: processedImage.thumbnailUrl,
        thumb: processedImage.thumbnailUrl,
      },

      originalUrl: processedImage.highResUrl,
      thumbnailUrl: processedImage.thumbnailUrl,

      width: processedImage.width,
      height: processedImage.height,
      aspectRatio: processedImage.width / processedImage.height,
      size: processedImage.size,
      format: processedImage.format,

      thumbHash: processedImage.thumbHash ?? null,

      // 一律 ?? null：Rust 那邊的 Option 序列化成 null 而不是省略 key，
      // 兩個寫入端要產出同一個形狀，manifest 才只有一種讀法。
      exif: {
        make: exifData.make ?? null,
        model: exifData.model ?? null,
        LensModel: exifData.lensModel ?? null,
        FocalLength: exifData.focalLength ?? null,
        FocalLengthIn35mmFormat: exifData.focalLengthIn35mm ?? null,
        FNumber: exifData.fNumber ?? null,
        ExposureTime: exifData.exposureTime ?? null,
        ISO: exifData.iso ?? null,
        DateTimeOriginal: exifData.dateTimeOriginal ?? null,
        Software: exifData.software ?? null,
        Flash: exifData.flash ?? null,
        WhiteBalance: exifData.whiteBalance ?? null,
        MeteringMode: exifData.meteringMode ?? null,
      },

      gps: exifData.gps
        ? { ...exifData.gps, altitude: exifData.gps.altitude ?? null }
        : null,
      shootTime: shootTime ?? null,

      tags: [],
      tagsEn: [],
    };

    console.log(`  ✅ 完成: ${fileName}`);
    return manifest;
  } catch (error) {
    console.error(`  ❌ 處理失敗: ${path.basename(inputPath)}`, error);
    return null;
  }
}

/**
 * 主要構建函數
 */
export async function build() {
  console.log('🚀 照片構建器啟動\n');

  const stats: BuildStats = {
    total: 0,
    processed: 0,
    failed: 0,
    skipped: 0,
    startTime: Date.now(),
  };

  try {
    // 1. 載入配置 & 現有 Manifest
    console.log('📝 載入配置...');
    const config = await loadConfig();
    console.log(`  來源: ${config.source.type} - ${config.source.path}`);
    console.log(`  輸出: ${config.output.directory}`);
    console.log(`  Manifest: ${config.output.manifestPath}\n`);

    // 讀取現有的 manifest 以支援增量構建
    const existingManifests = new Map<string, PhotoManifest>();
    try {
      const existingData = await fs.readFile(config.output.manifestPath, 'utf-8');
      const parsed = JSON.parse(existingData);
      if (Array.isArray(parsed.photos)) {
        parsed.photos.forEach((p: PhotoManifest) => existingManifests.set(p.id, p));
        console.log(`  📚 讀取到 ${existingManifests.size} 筆現有資料，將進行增量構建`);
      }
    } catch {
      console.log('  ✨ 無現有 manifest，將進行完整構建');
    }

    // 2. 掃描照片
    console.log('🔍 掃描照片...');
    const photos = await scanPhotos(config.source.path, config.source.excludeRegex);
    stats.total = photos.length;
    console.log(`  找到 ${photos.length} 張照片\n`);

    if (photos.length === 0) {
      console.log('⚠️  未找到任何照片');
      return;
    }

    // 3. 處理照片
    console.log('🎨 開始處理照片...\n');
    const manifests: PhotoManifest[] = [];

    for (let i = 0; i < photos.length; i++) {
      const inputPath = photos[i];
      const photoId = path.basename(inputPath, path.extname(inputPath));

      // 檢查是否已存在且檔案完好
      const existing = existingManifests.get(photoId);
      if (existing) {
        // 簡單檢查輸出檔案是否還在
        const thumbPath = path.join(config.output.directory, path.basename(existing.thumbnailUrl));
        const highResPath = path.join(config.output.directory, path.basename(existing.originalUrl));

        try {
          await fs.access(thumbPath);
          await fs.access(highResPath);
          // 檔案存在，跳過處理
          console.log(`⏩ [${i + 1}] 跳過已存在: ${path.basename(inputPath)}`);
          manifests.push(existing);
          stats.skipped++;
          continue;
        } catch {
          // 檔案缺失，重新處理
          console.log(`Rule [${i + 1}] 檔案缺失，重新處理: ${path.basename(inputPath)}`);
        }
      }

      const manifest = await processPhoto(
        inputPath,
        config.output.directory,
        config,
        i + 1
      );

      if (manifest) {
        manifests.push(manifest);
        stats.processed++;
      } else {
        stats.failed++;
      }
    }

    // 4. 生成 manifest.json
    console.log('\n📦 生成 manifest.json...');
    const manifestData = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      totalPhotos: manifests.length,
      photos: manifests,
    };

    await fs.mkdir(path.dirname(config.output.manifestPath), { recursive: true });
    await fs.writeFile(
      config.output.manifestPath,
      JSON.stringify(manifestData, null, 2),
      'utf-8'
    );

    console.log(`  ✅ Manifest 已生成: ${config.output.manifestPath}`);

    // 5. 顯示統計
    stats.endTime = Date.now();
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(50));
    console.log('📊 構建統計');
    console.log('='.repeat(50));
    console.log(`總數: ${stats.total}`);
    console.log(`成功: ${stats.processed}`);
    console.log(`失敗: ${stats.failed}`);
    console.log(`耗時: ${duration}s`);
    console.log('='.repeat(50));
    console.log('\n✨ 構建完成!\n');
  } catch (error) {
    console.error('\n❌ 構建失敗:', error);
    process.exit(1);
  }
}

// 自動執行構建
build();
