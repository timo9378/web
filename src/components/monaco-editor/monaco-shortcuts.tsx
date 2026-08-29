import { useEffect } from 'react';
import type { IKeyboardEvent } from 'monaco-editor';
import type { MonacoShortcutsProps } from './types';

/**
 * Monaco 編輯器快捷鍵 Hook
 */
export function useMonacoShortcuts({
  editor,
  onBold,
  onItalic,
  onLink,
  onImage,
  onUndo,
  onRedo,
}: MonacoShortcutsProps) {
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: IKeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd) {
        switch (e.code) {
          case 'KeyB':
            e.preventDefault();
            onBold();
            break;
          case 'KeyI':
            e.preventDefault();
            onItalic();
            break;
          case 'KeyK':
            e.preventDefault();
            onLink();
            break;
          case 'KeyG':
            if (e.shiftKey) {
              e.preventDefault();
              onImage();
            }
            break;
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) {
              if (onRedo) onRedo();
            } else {
              if (onUndo) onUndo();
            }
            break;
          case 'KeyY':
            e.preventDefault();
            if (onRedo) onRedo();
            break;
        }
      }
    };

    const disposable = editor.onKeyDown(handleKeyDown);

    // onKeyDown 依 monaco 的型別一定回 IDisposable，不需要再 typeof 檢查一次
    return () => {
      disposable.dispose();
    };
  }, [editor, onBold, onItalic, onLink, onImage, onUndo, onRedo]);
}
