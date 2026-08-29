import type { editor } from 'monaco-editor';
import type { TextAction } from './types';
import { TEXT_ACTIONS } from './types';

/**
 * Monaco 編輯器文字處理工具類
 */
export class MonacoTextHelper {
  private editor: editor.IStandaloneCodeEditor;

  constructor(editor: editor.IStandaloneCodeEditor) {
    this.editor = editor;
  }

  /**
   * 切換文字包裹格式（粗體、斜體、連結等）
   */
  private toggleTextWrapping(action: TextAction): void {
    const model = this.editor.getModel();
    if (!model) return;

    const selection = this.editor.getSelection();
    if (!selection) return;

    const selectedText = model.getValueInRange(selection);
    const { before, after = '', placeholder = '' } = action;

    // 檢查是否已經有格式
    const beforeText = model.getValueInRange({
      startLineNumber: selection.startLineNumber,
      startColumn: Math.max(1, selection.startColumn - before.length),
      endLineNumber: selection.startLineNumber,
      endColumn: selection.startColumn,
    });

    const afterText = model.getValueInRange({
      startLineNumber: selection.endLineNumber,
      startColumn: selection.endColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: Math.min(model.getLineMaxColumn(selection.endLineNumber), selection.endColumn + after.length),
    });

    // 如果已有格式，則移除
    if (beforeText === before && afterText === after) {
      this.editor.executeEdits('remove-formatting', [
        {
          range: {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn - before.length,
            endLineNumber: selection.startLineNumber,
            endColumn: selection.startColumn,
          },
          text: '',
        },
        {
          range: {
            startLineNumber: selection.endLineNumber,
            startColumn: selection.endColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn + after.length,
          },
          text: '',
        },
      ]);

      // 更新選取範圍
      this.editor.setSelection({
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn - before.length,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn - before.length,
      });
    } else {
      // 添加格式
      const textToInsert = selectedText || placeholder;
      const newText = `${before}${textToInsert}${after}`;

      this.editor.executeEdits('add-formatting', [
        {
          range: selection,
          text: newText,
        },
      ]);

      // 如果沒有選取文字，選中 placeholder
      if (!selectedText) {
        this.editor.setSelection({
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn + before.length,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.startColumn + before.length + placeholder.length,
        });
      }
    }

    this.editor.focus();
  }

  /**
   * 切換粗體格式
   */
  applyBold(): void {
    this.toggleTextWrapping(TEXT_ACTIONS.bold);
  }

  /**
   * 切換斜體格式
   */
  applyItalic(): void {
    this.toggleTextWrapping(TEXT_ACTIONS.italic);
  }

  /**
   * 插入連結格式
   */
  insertLink(): void {
    this.toggleTextWrapping(TEXT_ACTIONS.link);
  }

  /**
   * 插入圖片格式
   */
  insertImage(): void {
    this.toggleTextWrapping(TEXT_ACTIONS.image);
  }

  /**
   * 取得編輯器內容
   */
  getValue(): string {
    return this.editor.getValue() || '';
  }

  /**
   * 設置編輯器內容
   */
  setValue(value: string): void {
    this.editor.setValue(value);
  }
}
