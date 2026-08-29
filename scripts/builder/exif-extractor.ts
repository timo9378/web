/**
 * EXIF Extractor
 * 提取照片的 EXIF 資訊
 */

import ExifReader from 'exifreader';
import * as fs from 'fs/promises';

export interface ExtractedExif {
  // 相機資訊
  make?: string;
  model?: string;
  lensModel?: string;
  software?: string;

  // 拍攝參數
  focalLength?: string;
  focalLengthIn35mm?: string;
  fNumber?: string;
  exposureTime?: string;
  iso?: string;
  flash?: string;
  whiteBalance?: string;
  meteringMode?: string;

  // 時間
  dateTimeOriginal?: string;
  /** EXIF 2.31 的 OffsetTimeOriginal，形如 "+08:00"。相機沒寫就是 undefined。 */
  offsetTimeOriginal?: string;
  createDate?: string;

  // GPS
  gps?: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };

  // 圖片資訊
  width?: number;
  height?: number;
  orientation?: number;
}

/**
 * 從照片檔案中提取 EXIF
 */
export async function extractExif(filePath: string): Promise<ExtractedExif> {
  try {
    const buffer = await fs.readFile(filePath);
    const tags = ExifReader.load(buffer, { expanded: true });

    const exif: ExtractedExif = {};

    // exifreader 的 tag 結構隨檔案而異（各 IFD 群組、欄位都可能不存在），
    // 用巢狀 optional 索引取值；型別給到「可遞迴的未知物件」即可，不必用 any。
    // exifreader 的結構是 tags[群組][標籤].description，各層都可能不存在。
    // 存取一律走 optional chaining，型別給到這個形狀即可，不必用 any。
    interface ExifTag {
      description?: string;
      value?: unknown;
    }
    type ExifGroup = Record<string, ExifTag | undefined>;
    const tagData = tags as unknown as Record<string, ExifGroup | undefined>;

    // 相機資訊
    if (tagData.ifd0?.Make?.description) {
      exif.make = tagData.ifd0.Make.description;
    }
    if (tagData.ifd0?.Model?.description) {
      exif.model = tagData.ifd0.Model.description;
    }
    if (tagData.exif?.LensModel?.description) {
      exif.lensModel = tagData.exif.LensModel.description;
    }
    if (tagData.ifd0?.Software?.description) {
      exif.software = tagData.ifd0.Software.description;
    }

    // 拍攝參數
    if (tagData.exif?.FocalLength?.description) {
      exif.focalLength = tagData.exif.FocalLength.description;
    }
    if (tagData.exif?.FocalLengthIn35mmFilm?.description) {
      exif.focalLengthIn35mm = tagData.exif.FocalLengthIn35mmFilm.description;
    }
    if (tagData.exif?.FNumber?.description) {
      exif.fNumber = tagData.exif.FNumber.description;
    }
    if (tagData.exif?.ExposureTime?.description) {
      exif.exposureTime = tagData.exif.ExposureTime.description;
    }
    if (tagData.exif?.ISOSpeedRatings?.description) {
      exif.iso = tagData.exif.ISOSpeedRatings.description;
    }
    if (tagData.exif?.Flash?.description) {
      exif.flash = tagData.exif.Flash.description;
    }
    if (tagData.exif?.WhiteBalance?.description) {
      exif.whiteBalance = tagData.exif.WhiteBalance.description;
    }
    if (tagData.exif?.MeteringMode?.description) {
      exif.meteringMode = tagData.exif.MeteringMode.description;
    }

    // 時間
    if (tagData.exif?.DateTimeOriginal?.description) {
      exif.dateTimeOriginal = tagData.exif.DateTimeOriginal.description;
    }
    // EXIF 2.31 的時區 tag。DateTimeOriginal 只有牆上時間、不帶時區，時區在這裡
    // （實測來源檔 248/248 都有寫）。兩個寫入端要產同一種格式，這邊也得取。
    if (tagData.exif?.OffsetTimeOriginal?.description) {
      exif.offsetTimeOriginal = tagData.exif.OffsetTimeOriginal.description;
    } else if (tagData.exif?.OffsetTime?.description) {
      exif.offsetTimeOriginal = tagData.exif.OffsetTime.description;
    }
    if (tagData.exif?.CreateDate?.description) {
      exif.createDate = tagData.exif.CreateDate.description;
    }

    // GPS
    if (tagData.gps?.Latitude && tagData.gps?.Longitude) {
      exif.gps = {
        latitude: tagData.gps.Latitude as number,
        longitude: tagData.gps.Longitude as number,
      };
      if (tagData.gps.Altitude) {
        exif.gps.altitude = tagData.gps.Altitude as number;
      }
    }

    // 圖片資訊
    if (tagData.file?.['Image Width']?.value) {
      exif.width = tagData.file['Image Width'].value as number;
    }
    if (tagData.file?.['Image Height']?.value) {
      exif.height = tagData.file['Image Height'].value as number;
    }
    if (tagData.ifd0?.Orientation?.value) {
      exif.orientation = tagData.ifd0.Orientation.value as number;
    }

    return exif;
  } catch (error) {
    console.error(`❌ 提取 EXIF 失敗: ${filePath}`, error);
    return {};
  }
}

/**
 * 格式化光圈值
 */
export function formatAperture(fNumber?: string): string {
  if (!fNumber) return '';
  return `f/${fNumber}`;
}

/**
 * 格式化快門速度
 */
export function formatShutterSpeed(exposureTime?: string): string {
  if (!exposureTime) return '';
  const num = parseFloat(exposureTime);
  if (num >= 1) return `${num}s`;
  return `1/${Math.round(1 / num)}s`;
}

/**
 * 格式化焦距
 */
export function formatFocalLength(focalLength?: string): string {
  if (!focalLength) return '';
  return `${focalLength}mm`;
}

/** OffsetTime* 的合法形式是 "+08:00" / "-05:00"；格式不對就當沒有。 */
const UTC_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

/**
 * exiftool 的 "2023:04:27 10:56:22" + "+08:00" → "2023-04-27T10:56:22+08:00"。
 *
 * 沒有 offset 就輸出不帶時區的裸本地時間——相機沒說時區的時候不要假裝知道。
 * 這個格式與後端 handlers::gallery::extract_exif 一致（同一份 manifest 兩個寫入端）。
 */
export function toIsoWithOffset(dateTimeOriginal?: string, offset?: string): string | undefined {
  if (!dateTimeOriginal) return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(dateTimeOriginal);
  const naive = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : dateTimeOriginal;
  return offset && UTC_OFFSET_RE.test(offset) ? `${naive}${offset}` : naive;
}
