/**
 * Photo Builder Configuration
 * 照片構建器配置
 */

import * as path from 'path';

export interface BuilderConfig {
  // 照片來源
  source: {
    type: 'local' | 's3';
    path: string; // 本地路徑或 S3 bucket
    excludeRegex?: string;
  };

  // 輸出設定
  output: {
    directory: string; // 生成圖片的輸出目錄
    manifestPath: string; // manifest.json 的路徑
  };

  // 圖片處理設定
  processing: {
    // 縮圖設定
    thumbnail: {
      width: number; // 縮圖寬度
      quality: number; // 壓縮品質 (1-100)
      format: 'webp' | 'jpeg';
    };

    // 高解析度圖片設定
    highRes: {
      maxWidth: number; // 最大寬度
      quality: number; // 壓縮品質
      format: 'webp' | 'jpeg';
    };

    // 功能開關
    enableThumbHash: boolean; // 啟用 ThumbHash
    enableLivePhoto: boolean; // 啟用 Live Photo 處理
  };
}

/**
 * 預設配置
 */
export const defaultConfig: BuilderConfig = {
  source: {
    type: 'local',
    path: './photos',
  },

  output: {
    directory: './public/generated',
    manifestPath: './public/photos-manifest.json',
  },

  processing: {
    thumbnail: {
      width: 600,
      quality: 80,
      format: 'webp',
    },

    highRes: {
      maxWidth: 2400,
      quality: 85,
      format: 'jpeg',
    },

    enableThumbHash: true,
    enableLivePhoto: true,
  },
};

/**
 * 載入配置
 */
export async function loadConfig(): Promise<BuilderConfig> {
  try {
    // 從本檔位置往上推，而不是 process.cwd()——從子目錄跑腳本時 cwd 會不同，
    // 以前那樣寫會靜靜退回預設配置（catch 只印警告），照片路徑就整個錯掉。
    // 放 .config/ 而不是這個資料夾：.gitignore 有 `scripts/builder/**/*.js`（builder 的
    // TS 編譯產物），設定檔放進來會被一起忽略。
    const configPath = path.resolve(import.meta.dirname, '../../.config/builder.config.js');
    console.log(`  Trying to load config from: ${configPath}`);

    // 嘗試載入 builder.config.js
    const userConfig = await import(configPath).then(
      (m) => m.default || m
    );
    console.log('  ✅ Config loaded successfully');
    return { ...defaultConfig, ...userConfig };
  } catch (error) {
    console.log('⚠️  未找到 builder.config.js 或載入失敗，使用預設配置');
    console.error('  Error details:', error);
    return defaultConfig;
  }
}
