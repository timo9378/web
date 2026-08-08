// 命令面板的開關。
//
// 為什麼要抽出來：`CommandPalette` 原本把 `open` 存在自己的 useState 裡，唯一的入口是
// ⌘K / Ctrl+K。那對桌機沒問題，但**手機沒有那個鍵**——面板等於只有一半的人打得開。
// 404 頁想給一個「搜尋看看」的按鈕，就必須有辦法從外面打開它。
//
// 用 `useSyncExternalStore` 而不是 jotai：這只是一個 boolean，加一個 Provider 與相依
// 不划算；也跟 `scrollStore` 同一套寫法（見那個檔的說明）。
//
// ⚠ `subscribe` 與 `getSnapshot` 都必須是**模組層級的穩定參考**。每次 render 換一個新
//   函式會讓 React 不斷重新訂閱，而症狀是「面板偶爾要按兩次才開」這種很難查的東西。

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => open;
// SSR 期間永遠是關的：面板本來就只在 client 互動後才出現
const getServerSnapshot = () => false;

export const openCommandPalette = () => {
  if (open) return;
  open = true;
  emit();
};

export const closeCommandPalette = () => {
  if (!open) return;
  open = false;
  emit();
};

export const toggleCommandPalette = () => {
  open = !open;
  emit();
};

/** 面板是否開著。訂閱式，任何元件都讀得到。 */
export const useCommandPaletteOpen = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
