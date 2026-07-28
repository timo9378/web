import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import Editor from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import { MonacoToolbar } from './monaco-toolbar';
import PhotoSelectorModal from '../admin/PhotoSelectorModal';
import PostLinkModal from '../admin/PostLinkModal';
import { useMonacoShortcuts } from './monaco-shortcuts';
import { MonacoTextHelper } from './monaco-text-helper';
import type { MonacoEditorProps } from './types';
import { getActiveSnippets } from './monaco-snippets';
import './monaco-glass.css';

const VIM_MODE_KEY = 'koimsurai_vim_mode';

/** @monaco-editor/react 的 loader 會把 monaco 掛到 window；用型別安全方式取用全域 monaco */
function getMonaco(): typeof Monaco | undefined {
  return (window as unknown as { monaco?: typeof Monaco }).monaco;
}

/** NAS/上傳照片選擇器回傳的照片形狀（僅取用到的欄位） */
interface SelectablePhoto {
  title?: string;
  highResUrl?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  urls?: { full?: string };
}

export default function MonacoEditor({
  value,
  onChange,
  language = 'markdown',
  theme = 'vs-dark',
  height = '400px',
  options = {},
  showToolbar = true,
  path,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const textHelperRef = useRef<MonacoTextHelper | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const disposablesRef = useRef<IDisposable[]>([]);

  // NAS Selector State
  const [showNASSelector, setShowNASSelector] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+Shift+K → 插入舊文章連結（C-3）
  const [showPostLinkModal, setShowPostLinkModal] = useState(false);

  // Vim 模式（C-1）— 狀態 + lifecycle 由 useEffect 接管
  const [vimMode, setVimMode] = useState<boolean>(() => {
    try { return localStorage.getItem(VIM_MODE_KEY) === '1'; } catch { return false; }
  });
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const vimAdapterRef = useRef<{ dispose: () => void } | null>(null);

  // 統計數據
  const [totalWords, setTotalWords] = useState(0);
  const [totalChars, setTotalChars] = useState(0);
  const [totalLines, setTotalLines] = useState(0);

  const [selWords, setSelWords] = useState(0);
  const [selChars, setSelChars] = useState(0);
  const [selLines, setSelLines] = useState(0);

  /**
   * 開啟 NAS 照片選擇器
   */
  const handleNAS = useCallback(() => {
    setShowNASSelector(true);
  }, []);

  /**
   * 處理 NAS 照片選擇
   */
  const handleNASSelect = useCallback((photo: SelectablePhoto) => {
    // 插入 markdown 圖片
    const editor = editorRef.current;
    if (!editor) return;

    const position = editor.getPosition();
    if (position) {
      const monacoNs = getMonaco();
      if (monacoNs) {
        // 使用 highResUrl 或 thumbnailUrl，這裡預設 highResUrl
        // 需注意 url 已經包含 /nas-images/ 前綴
        const imageUrl =
          photo.highResUrl ??
          photo.originalUrl ??
          photo.urls?.full ??
          photo.thumbnailUrl;
        const textToInsert = `![${photo.title ?? 'image'}](${imageUrl})\n`;

        editor.executeEdits('insert-nas-image', [{
          range: new monacoNs.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          text: textToInsert,
        }]);
      }
    }
    setShowNASSelector(false);
  }, []);

  /**
   * 處理圖片檔案上傳
   */
  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    // Reset input so same file can be selected again
    e.target.value = '';

    const editorInstance = editorRef.current;
    if (!editorInstance) return;

    setUploading(true);
    try {
      let blob: Blob;
      let filename: string;

      // GIF 保持原格式，不轉 webp
      if (file.type === 'image/gif') {
        blob = file;
        filename = file.name;
      } else {
        // 壓縮圖片到 max 1920px 並轉 webp
        const bitmap = await createImageBitmap(file);
        const MAX = 1920;
        let w = bitmap.width, h = bitmap.height;
        if (w > MAX || h > MAX) {
          const ratio = Math.min(MAX / w, MAX / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = new OffscreenCanvas(w, h);
        // getContext 可能回 null（同時開太多 context 時瀏覽器會拒絕），
        // 斷言掉只是把錯誤延到執行期。取不到就跳過縮圖、沿用原圖。
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('OffscreenCanvas 2d context 取得失敗');
        ctx.drawImage(bitmap, 0, 0, w, h);
        blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
        bitmap.close();
        filename = file.name.replace(/\.[^/.]+$/, '') + '.webp';
      }

      const formData = new FormData();
      formData.append('file', blob, filename);

      const token = localStorage.getItem('koimsurai_user_token');
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? 'Upload failed');
      }

      const data = await res.json() as { url: string };
      const imageUrl = data.url;

      // 插入 markdown
      const position = editorInstance.getPosition();
      if (position) {
        const monacoNs = getMonaco();
        if (monacoNs) {
          const altText = file.name.replace(/\.[^/.]+$/, '');
          editorInstance.executeEdits('upload-image', [{
            range: new monacoNs.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            text: `![${altText}](${imageUrl})\n`,
          }]);
        }
      }
    } catch (err) {
      console.error('Upload image error:', err);
      alert('圖片上傳失敗: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }, []);

  /**
   * 編輯器掛載完成時的回調
   */
  const handleEditorDidMount = useCallback(
    (editor: editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
      textHelperRef.current = new MonacoTextHelper(editor);
      setIsEditorReady(true);

      /**
       * 計算字形數量（使用者感知的字元）
       */
      const countGraphemes = (text: string): number => {
        if (!text) return 0;
        const normalized = text.replace(/\r\n/g, '\n');
        if ('Segmenter' in Intl) {
          try {
            const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            let count = 0;
            for (const _ of seg.segment(normalized)) count++;
            return count;
          } catch {
            // fallback
          }
        }
        return Array.from(normalized).length;
      };

      /**
       * 智慧計算單字數量
       */
      const countWords = (text: string): number => {
        if (!text) return 0;

        const hasCJK =
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
        if (hasCJK) {
          if ('Segmenter' in Intl) {
            try {
              const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
              let count = 0;
              for (const segment of seg.segment(text)) {
                if (segment.isWordLike) count++;
              }
              if (count > 0) return count;
            } catch {
              // fallback
            }
          }
        }

        const other = text.match(/\p{L}+/gu) ?? [];
        return other.length;
      };

      /**
       * 更新所有統計數據
       */
      const updateAllStats = () => {
        try {
          const model = editor.getModel();
          if (!model) return;
          const value = model.getValue();
          setTotalChars(countGraphemes(value));
          setTotalLines(model.getLineCount());
          setTotalWords(countWords(value));
        } catch {
          // ignore
        }
      };

      /**
       * 更新選取範圍的統計數據
       */
      const updateSelectionStats = () => {
        try {
          const selection = editor.getSelection();
          const model = editor.getModel();
          if (!model || !selection) {
            setSelChars(0);
            setSelLines(0);
            setSelWords(0);
            return;
          }

          const selectedText = model.getValueInRange(selection) || '';
          setSelChars(countGraphemes(selectedText));
          setSelLines(
            selectedText ? selectedText.split(/\r\n|\r|\n/).length : 0
          );
          setSelWords(countWords(selectedText));
        } catch {
          // ignore
        }
      };

      // 初始更新
      updateAllStats();
      updateSelectionStats();

      // 訂閱事件
      const contentDisposable = editor.onDidChangeModelContent(() => {
        updateAllStats();
        updateSelectionStats();
      });

      const selectionDisposable = editor.onDidChangeCursorSelection(() => {
        updateSelectionStats();
      });

      disposablesRef.current.push(contentDisposable, selectionDisposable);

      // 監聽 Paste 事件 — 使用 capture 以優先攔截圖片貼上
      const domNode = editor.getContainerDomNode();
      const pasteHandler = async (e: ClipboardEvent) => {
        if (!e.clipboardData) return;

        // 先檢查焦點是否在 editor 範圍內
        const activeEl = document.activeElement;
        if (!domNode.contains(activeEl)) return;

        // 檢查是否有圖片檔案
        let imageFile: File | null = null;
        for (const f of e.clipboardData.files) {
          if (f.type.startsWith('image/')) {
            imageFile = f;
            break;
          }
        }
        // 也檢查 items (某些瀏覽器用 items 而非 files)
        if (!imageFile && e.clipboardData.items) {
          for (const item of e.clipboardData.items) {
            if (item.type.startsWith('image/')) {
              imageFile = item.getAsFile();
              break;
            }
          }
        }
        if (!imageFile) return;

        e.preventDefault();
        e.stopPropagation();

        try {
          // 壓縮圖片到 max 1024px
          const bitmap = await createImageBitmap(imageFile);
          const MAX = 1024;
          let w = bitmap.width, h = bitmap.height;
          if (w > MAX || h > MAX) {
            const ratio = Math.min(MAX / w, MAX / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = new OffscreenCanvas(w, h);
          // getContext 可能回 null（同時開太多 context 時瀏覽器會拒絕），
          // 斷言掉只是把錯誤延到執行期。取不到就跳過縮圖、沿用原圖。
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('OffscreenCanvas 2d context 取得失敗');
          ctx.drawImage(bitmap, 0, 0, w, h);
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
          bitmap.close();

          // Upload to Server
          const formData = new FormData();
          formData.append('file', blob, imageFile.name.replace(/\.[^/.]+$/, "") + ".webp");

          const token = localStorage.getItem('koimsurai_user_token');
          const res = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(errData.error ?? 'Upload failed');
          }

          const data = await res.json() as { url: string };
          const imageUrl = data.url; // e.g., /uploads/2023/10/xyz.webp

          // 插入 markdown 圖片
          const position = editor.getPosition();
          if (position) {
            const monacoNs = getMonaco();
            if (monacoNs) {
              editor.executeEdits('paste-image', [{
                range: new monacoNs.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: `![image](${imageUrl})\n`,
              }]);
            }
          }
        } catch (err) {
          console.error('Paste/Upload image error:', err);
          alert('圖片上傳失敗: ' + (err instanceof Error ? err.message : String(err)));
        }
      };

      // 使用 capture: true 讓事件在 capture 階段就被攔截，優先於 Monaco 的 handler
      const onPasteCapture = (e: ClipboardEvent): void => { void pasteHandler(e); };
      window.addEventListener('paste', onPasteCapture, true);

      // 添加到 cleanup
      disposablesRef.current.push({
        dispose: () => window.removeEventListener('paste', onPasteCapture, true)
      });

      /* ── 拖放圖片上傳（與 paste 共用 upload 邏輯）── */
      const uploadAndInsertImage = async (imageFile: File) => {
        try {
          let blob: Blob;
          let filename: string;
          if (imageFile.type === 'image/gif') {
            blob = imageFile;
            filename = imageFile.name;
          } else {
            const bitmap = await createImageBitmap(imageFile);
            const MAX = 1920;
            let w = bitmap.width, h = bitmap.height;
            if (w > MAX || h > MAX) {
              const ratio = Math.min(MAX / w, MAX / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = new OffscreenCanvas(w, h);
            // getContext 可能回 null（同時開太多 context 時瀏覽器會拒絕），
            // 斷言掉只是把錯誤延到執行期。取不到就跳過縮圖、沿用原圖。
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('OffscreenCanvas 2d context 取得失敗');
            ctx.drawImage(bitmap, 0, 0, w, h);
            blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
            bitmap.close();
            filename = imageFile.name.replace(/\.[^/.]+$/, '') + '.webp';
          }
          const formData = new FormData();
          formData.append('file', blob, filename);
          const token = localStorage.getItem('koimsurai_user_token');
          const res = await fetch('/api/admin/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          });
          if (!res.ok) throw new Error('Upload failed');
          const data = await res.json() as { url: string };
          const position = editor.getPosition();
          if (position) {
            const monacoNs = getMonaco();
            if (monacoNs) {
              const altText = imageFile.name.replace(/\.[^/.]+$/, '');
              editor.executeEdits('drop-image', [{
                range: new monacoNs.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: `![${altText}](${data.url})\n`,
              }]);
            }
          }
        } catch (err) {
          console.error('Drop/Upload image error:', err);
          alert('圖片上傳失敗');
        }
      };

      const dragOverHandler = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        const hasFile = Array.from(e.dataTransfer.items || []).some(it => it.kind === 'file');
        if (!hasFile) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        domNode.classList.add('monaco-drop-active');
      };
      const dragLeaveHandler = () => domNode.classList.remove('monaco-drop-active');
      const dropHandler = async (e: DragEvent) => {
        domNode.classList.remove('monaco-drop-active');
        if (!e.dataTransfer?.files?.length) return;
        const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (!imageFiles.length) return;
        e.preventDefault();
        e.stopPropagation();
        for (const f of imageFiles) {
           
          await uploadAndInsertImage(f);
        }
      };
      const onDrop = (e: DragEvent): void => { void dropHandler(e); };
      domNode.addEventListener('dragover', dragOverHandler);
      domNode.addEventListener('dragleave', dragLeaveHandler);
      domNode.addEventListener('drop', onDrop);
      disposablesRef.current.push({
        dispose: () => {
          domNode.removeEventListener('dragover', dragOverHandler);
          domNode.removeEventListener('dragleave', dragLeaveHandler);
          domNode.removeEventListener('drop', onDrop);
        }
      });

      /* ── 斜線指令選單（markdown 模板插入；C-2: 內建 + 使用者自訂） ── */
      const monacoNs = getMonaco();
      if (monacoNs?.languages) {
        const provider = monacoNs.languages.registerCompletionItemProvider('markdown', {
          triggerCharacters: ['/'],
          provideCompletionItems: (model, position) => {
            const lineUntil = model.getValueInRange({
              startLineNumber: position.lineNumber, startColumn: 1,
              endLineNumber: position.lineNumber, endColumn: position.column,
            });
            const m = /(^|\s)(\/[a-z]*)$/.exec(lineUntil);
            if (!m) return { suggestions: [] };
            const slash = m[2];
            const startCol = position.column - slash.length;
            const range = new monacoNs.Range(position.lineNumber, startCol, position.lineNumber, position.column);
            // 動態取 snippets，使得使用者改 localStorage 後不必重啟編輯器
            const snippets = getActiveSnippets();
            return {
              suggestions: snippets.map(s => ({
                label: s.label,
                kind: monacoNs.languages.CompletionItemKind.Snippet,
                insertText: s.body,
                insertTextRules: monacoNs.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: s.detail,
                range,
              })),
            };
          },
        });
        disposablesRef.current.push(provider);
      }
    },
    []
  );

  // 清理工作
  useEffect(() => {
    return () => {
      setIsEditorReady(false);
      editorRef.current = null;
      textHelperRef.current = null;
      disposablesRef.current.forEach(
        (d) => d && typeof d.dispose === 'function' && d.dispose()
      );
      disposablesRef.current = [];
    };
  }, []);

  /**
   * 處理粗體格式切換
   */
  const handleBold = useCallback(() => {
    textHelperRef.current?.applyBold();
  }, []);

  /**
   * 處理斜體格式切換
   */
  const handleItalic = useCallback(() => {
    textHelperRef.current?.applyItalic();
  }, []);

  /**
   * 處理連結格式插入
   */
  const handleLink = useCallback(() => {
    textHelperRef.current?.insertLink();
  }, []);

  /**
   * 處理圖片格式插入
   */
  const handleImage = useCallback(() => {
    textHelperRef.current?.insertImage();
  }, []);

  /**
   * 處理復原動作
   */
  const handleUndo = useCallback(() => {
    editorRef.current?.trigger('app', 'undo', null);
  }, []);

  /**
   * 處理取消復原動作
   */
  const handleRedo = useCallback(() => {
    editorRef.current?.trigger('app', 'redo', null);
  }, []);

  /**
   * Vim 模式切換（C-1）
   */
  const handleVimToggle = useCallback(() => {
    setVimMode((v) => {
      const next = !v;
      try { localStorage.setItem(VIM_MODE_KEY, next ? '1' : '0'); } catch { /* ignore quota */ }
      return next;
    });
  }, []);

  /**
   * 開啟舊文章連結插入器（C-3）
   */
  const handleOpenPostLink = useCallback(() => {
    setShowPostLinkModal(true);
  }, []);

  /**
   * 從 PostLinkModal 選定後插入 markdown 連結
   */
  const handlePostLinkSelect = useCallback(
    (post: { title?: string; id?: number | string }) => {
      const editor = editorRef.current;
      setShowPostLinkModal(false);
      if (!editor) return;
      const url = `/blog/${post.id}`;
      const selection = editor.getSelection();
      const model = editor.getModel();
      const selectedText = selection && model ? model.getValueInRange(selection) : '';
      const text = `[${selectedText || post.title}](${url})`;
      const monacoNs = getMonaco();
      if (!monacoNs || !selection) return;
      editor.executeEdits('insert-post-link', [{
        range: new monacoNs.Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn),
        text,
      }]);
      editor.focus();
    },
    []
  );

  // Vim 模式 lifecycle：editor ready + vimMode true → 動態載入 monaco-vim 並初始化
  // 切回 false 或 unmount 時 dispose
  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !vimMode) {
      if (vimAdapterRef.current) {
        try { vimAdapterRef.current.dispose(); } catch { /* ignore */ }
        vimAdapterRef.current = null;
      }
      return;
    }
    let cancelled = false;
    import('monaco-vim').then(({ initVimMode }) => {
      if (cancelled || !editorRef.current) return;
      vimAdapterRef.current = initVimMode(editorRef.current, vimStatusRef.current);
    }).catch((err) => {
      console.error('monaco-vim 載入失敗:', err);
    });
    return () => {
      cancelled = true;
      if (vimAdapterRef.current) {
        try { vimAdapterRef.current.dispose(); } catch { /* ignore */ }
        vimAdapterRef.current = null;
      }
    };
  }, [isEditorReady, vimMode]);

  // 註冊快捷鍵
  useMonacoShortcuts({
    editor: editorRef.current,
    onBold: handleBold,
    onItalic: handleItalic,
    onLink: handleLink,
    onImage: handleImage,
    onUndo: handleUndo,
    onRedo: handleRedo,
  });

  // Cmd/Ctrl+Shift+K：開啟舊文章連結插入器（C-3）
  useEffect(() => {
    const editor = editorRef.current;
    if (!isEditorReady || !editor) return;
    const monacoNs = getMonaco();
    if (!monacoNs) return;
    const action = editor.addAction({
      id: 'koimsurai.insert-post-link',
      label: '插入舊文章連結',
      keybindings: [monacoNs.KeyMod.CtrlCmd | monacoNs.KeyMod.Shift | monacoNs.KeyCode.KeyK],
      run: () => handleOpenPostLink(),
    });
    return () => action.dispose();
  }, [isEditorReady, handleOpenPostLink]);

  // 閱讀時間（C-4）— 中文 ~500 字/min，英文 ~250 字/min；用混合估算
  const readingMinutes = useMemo(() => {
    if (!totalChars && !totalWords) return 0;
    // 假設大宗為 CJK：用字元數除以 500 較貼近實際
    const minutes = Math.max(1, Math.round(totalChars / 500));
    return minutes;
  }, [totalChars, totalWords]);

  const defaultOptions: editor.IStandaloneEditorConstructionOptions = {
    fontSize: 14,
    lineNumbers: 'on',
    roundedSelection: false,
    scrollBeyondLastLine: false,
    minimap: { enabled: true },
    automaticLayout: true,
    wordWrap: 'on',
    renderLineHighlight: 'gutter',
    selectOnLineNumbers: true,
    matchBrackets: 'always',
    contextmenu: true,
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: 'never',
      seedSearchStringFromSelection: 'always',
    },
    accessibilitySupport: 'auto',
    renderWhitespace: 'selection',
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    cursorBlinking: 'blink',
    mouseWheelZoom: true,
    tabSize: 2,
    insertSpaces: true,
    formatOnPaste: true,
    formatOnType: true,
    ...options,
  };

  return (
    <div className="monaco-editor-glass overflow-hidden">
      {showToolbar && (
        <div className="monaco-toolbar-sticky">
          <MonacoToolbar
            onBold={handleBold}
            onItalic={handleItalic}
            onLink={handleLink}
            onImage={handleImage}
            onNAS={handleNAS}
            onUpload={handleUpload}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onLinkPost={handleOpenPostLink}
            onVimToggle={handleVimToggle}
            vimMode={vimMode}
            disabled={!isEditorReady}
            uploading={uploading}
          />
        </div>
      )}

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => { void handleFileSelected(e); }}
        style={{ display: 'none' }}
      />

      {ReactDOM.createPortal(
        <PhotoSelectorModal
          isOpen={showNASSelector}
          onClose={() => setShowNASSelector(false)}
          onSelect={handleNASSelect}
        />,
        document.body
      )}

      {ReactDOM.createPortal(
        <PostLinkModal
          isOpen={showPostLinkModal}
          onClose={() => setShowPostLinkModal(false)}
          onSelect={handlePostLinkSelect}
        />,
        document.body
      )}

      <Editor
        height={height}
        language={language}
        value={value}
        path={path}
        onChange={onChange}
        theme={theme}
        options={defaultOptions}
        onMount={handleEditorDidMount}
        loading={
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">載入編輯器中...</div>
          </div>
        }
      />

      {/* Vim 模式狀態列：monaco-vim 會把 :command / 模式提示寫到這個 div */}
      {vimMode && <div ref={vimStatusRef} className="monaco-vim-status" />}

      {/* 狀態欄（C-4：加上閱讀時間） */}
      <div className="monaco-statusbar-glass flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground/70">
        <div>
          {totalWords} 字 · {totalChars} 字元 · {totalLines} 行
          {totalChars > 0 && <> · 約 {readingMinutes} 分鐘閱讀</>}
        </div>
        <div>
          選取: {selWords} 字 · {selChars} 字元 · {selLines} 行
        </div>
      </div>
    </div>
  );
}
