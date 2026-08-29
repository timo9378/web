/**
 * Photo Gallery State Management with Jotai
 * 照片牆全域狀態管理
 */

import { atom } from 'jotai';
import { atomWithReset } from 'jotai/utils';
import type { PhotoManifest } from '../types/photo';

/**
 * 當前選中的照片
 */
export const selectedPhotoAtom = atomWithReset<PhotoManifest | null>(null);

/**
 * 當前選中照片的索引。
 * 不 export：只有本檔的 open/closeViewer 兩個 action 在維護它，對外沒有意義。
 */
const selectedPhotoIndexAtom = atomWithReset<number>(-1);

/**
 * 當前照片索引 (用於 Swiper)
 */
export const currentIndexAtom = atomWithReset<number>(0);

/**
 * 照片查看器開啟狀態
 */
export const viewerOpenAtom = atomWithReset<boolean>(false);

/**
 * 照片清單
 */
export const photosAtom = atomWithReset<PhotoManifest[]>([]);

/* 以下三個同樣不 export：都只被本檔的 open/closeViewer 重置，
   實際的縮放與平移狀態在 PhotoViewer 自己手上。 */

/** EXIF 面板開啟狀態 */
const exifPanelOpenAtom = atomWithReset<boolean>(false);

/** 照片縮放等級 */
const zoomLevelAtom = atomWithReset<number>(1);

/** 照片平移位置 */
const panPositionAtom = atomWithReset<{ x: number; y: number }>({ x: 0, y: 0 });

/**
 * Action: 開啟照片查看器
 */
export const openViewerAtom = atom(null, (get, set, photo: PhotoManifest) => {
  const photos = get(photosAtom);
  const index = photos.findIndex((p) => p.id === photo.id);

  set(selectedPhotoAtom, photo);
  set(selectedPhotoIndexAtom, index);
  set(viewerOpenAtom, true);
  set(zoomLevelAtom, 1);
  set(panPositionAtom, { x: 0, y: 0 });
});

/**
 * Action: 關閉照片查看器
 */
export const closeViewerAtom = atom(null, (_get, set) => {
  set(viewerOpenAtom, false);
  set(selectedPhotoAtom, null);
  set(selectedPhotoIndexAtom, -1);
  set(exifPanelOpenAtom, false);
});
