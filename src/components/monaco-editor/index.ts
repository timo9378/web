// 只再匯出真的有外部消費者的東西。toolbar / shortcuts / text-helper 都只被
// 同資料夾的 monaco-editor.tsx 直接 import，掛在這裡只是讓 barrel 看起來比較完整。
export { default as MonacoEditor } from './monaco-editor';
export * from './types';
