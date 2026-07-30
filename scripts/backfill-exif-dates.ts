/**
 * 把 manifest 裡的 exif.DateTimeOriginal 收斂成「帶相機自身時區的 ISO 8601」。
 *
 * 為什麼不是 `pnpm build:photos`：
 *   1. builder 的 skip 路徑看到輸出檔還在就 push 舊資料，DateTimeOriginal 一個字都不會變
 *   2. 就算刪掉輸出檔強制重跑，也要把 248 張重新編碼（來源 204MB），只為改一個字串欄位
 * 這支只讀來源檔的 EXIF 檔頭、只改那一個欄位，其餘（tags / thumbHash / urls / size）原封不動。
 *
 * 用法（在 web/ 下）：
 *   pnpm tsx scripts/backfill-exif-dates.ts            # dry-run，只印會改什麼
 *   pnpm tsx scripts/backfill-exif-dates.ts --write    # 真的寫檔（會先備份）
 *
 * 路徑取自 builder.config.js，與 builder / 後端 sync 共用同一份 manifest。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from './builder/config';
import { extractExif, toIsoWithOffset } from './builder/exif-extractor';
import type { PhotoManifest } from '../src/types/photo';

interface Manifest {
  version: string;
  generatedAt: string;
  totalPhotos: number;
  photos: PhotoManifest[];
}

const WRITE = process.argv.includes('--write');

/** 來源檔可能是 .jpg/.jpeg/.png/.webp，manifest 的 id 是不含副檔名的檔名。 */
async function indexSourceFiles(root: string, excludeRegex?: string): Promise<Map<string, string>> {
  const exclude = excludeRegex ? new RegExp(excludeRegex) : null;
  const byId = new Map<string, string>();
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (exclude?.test(full)) continue;
      if (e.isDirectory()) await walk(full);
      else if (/\.(jpe?g|png|webp)$/i.test(e.name)) byId.set(path.basename(e.name, path.extname(e.name)), full);
    }
  }
  await walk(root);
  return byId;
}

async function main() {
  const config = await loadConfig();
  const manifestPath = config.output.manifestPath;
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as Manifest;
  console.log(`manifest: ${manifestPath}（${manifest.photos.length} 張）`);

  const sources = await indexSourceFiles(config.source.path, config.source.excludeRegex);
  console.log(`來源檔: ${config.source.path}（${sources.size} 個）\n`);

  let changed = 0;
  let already = 0;
  let noSource = 0;
  let noDate = 0;
  const samples: string[] = [];

  for (const photo of manifest.photos) {
    const src = sources.get(photo.id);
    if (!src) {
      noSource++;
      continue;
    }
    const exif = await extractExif(src);
    const next = toIsoWithOffset(exif.dateTimeOriginal, exif.offsetTimeOriginal);
    if (!next) {
      noDate++;
      continue;
    }
    const prev = photo.exif?.DateTimeOriginal ?? null;
    if (prev === next) {
      already++;
      continue;
    }
    if (samples.length < 5) samples.push(`  ${photo.id}\n    ${JSON.stringify(prev)}\n    → ${JSON.stringify(next)}`);
    // 只動這一個欄位；exif 物件本身可能不存在（極舊資料）
    photo.exif = { ...(photo.exif ?? {}), DateTimeOriginal: next } as PhotoManifest['exif'];
    changed++;
  }

  console.log('樣本：');
  console.log(samples.join('\n') || '  （沒有需要改的）');
  console.log(`\n要改 ${changed} 張；已是目標格式 ${already}；找不到來源檔 ${noSource}；來源檔無拍攝時間 ${noDate}`);

  if (!changed) return;
  if (!WRITE) {
    console.log('\n這是 dry-run。確認沒問題後加 --write 再跑一次。');
    return;
  }

  const backup = `${manifestPath}.bak-${manifest.generatedAt.replace(/[:.]/g, '-')}`;
  await fs.writeFile(backup, raw, 'utf-8');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  console.log(`\n已寫入 ${manifestPath}`);
  console.log(`備份   ${backup}`);
}

main().catch((e: unknown) => {
  console.error('backfill 失敗:', e);
  process.exit(1);
});
