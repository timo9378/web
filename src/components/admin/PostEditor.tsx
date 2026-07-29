'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminCategoriesQueryOptions, adminTagsQueryOptions, adminPostDetailQueryOptions } from '../../adminData';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { postSchema, type PostFormInput } from '@/schemas/post';
import { MonacoEditor } from '@/components/monaco-editor';
import { PostPreview } from './PostPreview';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  FileText,
  Clock,
  Folder,
  ImageIcon,
  X,
  Sparkles,
  Loader2,
  LayoutTemplate,
  Languages,
  Wand2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';

interface TagOption { label: string; value: string }
interface N8NData {
  title?: string;
  content?: string;
  tags?: unknown;
  slug?: string;
  summary?: string;
  category?: string;
  cover?: string;
  status?: 'draft' | 'published' | 'archived';
  layout_type?: 'record' | 'column';
  allowComments?: boolean;
  allow_comments?: boolean;
}
type LocalizedField =
  | 'title' | 'content' | 'summary'
  | 'title_en' | 'content_en' | 'summary_en'
  | 'title_zh_cn' | 'content_zh_cn' | 'summary_zh_cn'
  | 'title_ja' | 'content_ja' | 'summary_ja'
  | 'title_ko' | 'content_ko' | 'summary_ko';

/**
 * v0 風格標籤搜尋選擇器
 */
function TagSearchInput({ tags, selectedTags, onChange }: { tags: TagOption[]; selectedTags: TagOption[]; onChange: (tags: TagOption[]) => void }) {
  const [tagSearch, setTagSearch] = useState('');
  const selectedValues = new Set(selectedTags.map(t => t.value));
  const filteredTags = tags.filter(
    t => !selectedValues.has(t.value) && t.label.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const addTag = (tag: TagOption) => {
    onChange([...selectedTags, tag]);
    setTagSearch('');
  };

  return (
    <div className="relative">
      <Input
        placeholder="搜尋標籤..."
        value={tagSearch}
        onChange={(e) => setTagSearch(e.target.value)}
        className="bg-accent/30 border-border/50 text-foreground/80 text-xs h-8 placeholder:text-muted-foreground/40"
      />
      {tagSearch && filteredTags.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-border/40 bg-popover/95 backdrop-blur-sm p-1 z-50">
          {filteredTags.map((tag) => (
            <button
              key={tag.value}
              type="button"
              onClick={() => addTag(tag)}
              className="w-full text-left text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
      {tagSearch && filteredTags.length === 0 && (
        <div className="absolute left-0 right-0 mt-1.5 rounded-lg border border-border/40 bg-popover/95 backdrop-blur-sm p-3 z-50">
          <p className="text-center text-xs text-muted-foreground/60">沒有找到相關標籤</p>
        </div>
      )}
    </div>
  );
}

// ─── i18n 編輯常數 ──────────────────────────────
const LOCALE_TABS = [
  { code: 'zh-TW', label: '繁體', column: null },      // source 候選
  { code: 'en',    label: 'English', column: 'en' },
  { code: 'zh-CN', label: '简体',    column: 'zh_cn' },
  { code: 'ja',    label: '日本語',  column: 'ja' },
  { code: 'ko',    label: '한국어',  column: 'ko' },
];
// 依 activeLocale + sourceLanguage 取得表單 field 名稱
function fieldNameFor(base: 'title' | 'content' | 'summary', activeLocale: string, sourceLanguage: string): LocalizedField {
  if (activeLocale === sourceLanguage) return base;
  const tab = LOCALE_TABS.find(t => t.code === activeLocale);
  if (!tab?.column) return base; // fallback：未知 locale 用原文
  return `${base}_${tab.column}` as LocalizedField;
}

export default function PostEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingZhCN, setIsGeneratingZhCN] = useState(false);
  const [editorView, setEditorView] = useState('edit'); // edit | split | preview
  // 分類/標籤/文章明細改由 TanStack Query 讀（生成型別）；儲存等 mutation 各自處理。
  const { data: categories = [] } = useQuery(adminCategoriesQueryOptions);
  const { data: tagsData = [] } = useQuery(adminTagsQueryOptions);
  const tags = useMemo<TagOption[]>(() => tagsData.map((tag) => ({ label: tag.name, value: tag.id.toString() })), [tagsData]);
  const { data: postData, isPending: postPending } = useQuery({ ...adminPostDetailQueryOptions(id ?? ''), enabled: !!id });
  const isLoading = !!id && postPending; // 編輯模式載入文章時的骨架 gate
  const [activeLocale, setActiveLocale] = useState('zh-TW');
  const [zenMode, setZenMode] = useState(false);
  // 載入既有文章時，form.reset 在 Select mount 之後才跑 → Radix Select 的觸發器不會反映
  // 「事後才填進來的受控值」，看起來像被 reset（值其實有）。用這個旗標當 key 讓 Select 在
  // reset 完成後重新 mount 一次，用正確的值初始化 → 顯示正常。新文章保持 false（預設值本就正確）。
  const [hydrated, setHydrated] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState(''); // '', 'saved', 'restoring'
  const submitLockRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 狀態字（'saved'/'restoring'）1.8s 後自己消失。用 ref 追蹤才能在 unmount 時清掉，
  // 也避免連續存檔時多個計時器互相搶著把狀態清空。
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useCallback：只碰 ref 與 setState（兩者本身穩定），空依賴即恆等，
  // 才能誠實地列進下面 effect 的依賴陣列而不會每次 render 重跑 effect。
  const flashStatus = useCallback((s: string) => {
    setAutosaveStatus(s);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => { setAutosaveStatus(''); }, 1800);
  }, []);
  const autosaveKey = `postEditor:autosave:${id ?? 'new'}`;

  const form = useForm({
    resolver: zodResolver(postSchema),
    defaultValues: {
      title: '',
      content: '',
      slug: '',
      summary: '',
      category: '',
      tags: [],
      cover: '',
      status: 'draft',
      layout_type: 'record',
      allow_comments: true,
      send_newsletter: false,
      // i18n
      source_language: 'zh-TW',
      title_en: '', content_en: '', summary_en: '',
      title_zh_cn: '', content_zh_cn: '', summary_zh_cn: '',
      title_ja: '', content_ja: '', summary_ja: '',
      title_ko: '', content_ko: '', summary_ko: '',
      // 系列文
      series_name: '',
      series_order: '',
    },
  });

  const sourceLanguage = form.watch('source_language') ?? 'zh-TW';
  const titleName = fieldNameFor('title', activeLocale, sourceLanguage);
  const contentName = fieldNameFor('content', activeLocale, sourceLanguage);
  const summaryName = fieldNameFor('summary', activeLocale, sourceLanguage);

  // 直接訂閱當前 locale 對應的欄位值，避免 <FormField name={dynamic}> 在切換時
  // 共用 controller/Monaco model 造成「第二次切回顯示舊內容」的 bug。
  const titleValue = form.watch(titleName) ?? '';
  const contentValueRaw = form.watch(contentName);
  const contentValue = typeof contentValueRaw === 'string' ? contentValueRaw : '';
  const summaryValue = form.watch(summaryName) ?? '';
  // 預覽走 mdx / markdown 哪條渲染路。編輯器不管理 format 欄位（由 MCP/後端預設決定），
  // 所以看載入文章的 format；新文章沿用後端預設 markdown。
  const format = postData?.format ?? 'markdown';

  // 若 sourceLanguage 切到目前 activeLocale 不合法時（例如原本 source=zh-TW, activeLocale=en，之後改 source=en
  // 則 en 的編輯欄位切到 base 欄位），這裡確保 activeLocale 仍然指向有效 tab
  useEffect(() => {
    // 修正失效的 tab 選擇：LOCALE_TABS 由 sourceLanguage 推導，改動時舊的 activeLocale
    // 可能已不在清單裡。這是「校正外部變動造成的無效選擇」，不是可推導的衍生值。
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    if (!LOCALE_TABS.find(t => t.code === activeLocale)) setActiveLocale(sourceLanguage);
  }, [activeLocale, sourceLanguage]);

  // ── localStorage 自動備份草稿（debounce 1.2s）──
  useEffect(() => {
    const sub = form.watch((values) => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        try {
          const hasContent = (values.title ?? '').trim() || (values.content ?? '').trim();
          if (!hasContent) return;
          localStorage.setItem(autosaveKey, JSON.stringify({ values, savedAt: Date.now() }));
          flashStatus('saved');
        } catch { /* quota exceeded 等 — 忽略 */ }
      }, 1200);
    });
    // 除了退訂，兩個計時器也要收：debounce 中途 unmount 會留下 1.2s 的排程，
    // 狀態字的 1.8s 同理。
    return () => {
      sub.unsubscribe();
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [autosaveKey, form, flashStatus]);

  // ── 還原草稿：新文章載入時若有備份且尚未填內容，提示還原 ──
  useEffect(() => {
    if (id) return; // 編輯既有文章不還原
    try {
      const raw = localStorage.getItem(autosaveKey);
      if (!raw) return;
      const { values, savedAt } = JSON.parse(raw) as { values?: PostFormInput; savedAt?: number };
      if (!values || !savedAt) return;
      // 24 小時內的草稿才還原
      if (Date.now() - savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(autosaveKey);
        return;
      }
      const current = form.getValues();
      if (((current.title) || (current.content)).trim()) return;
      const ago = Math.round((Date.now() - savedAt) / 60000);
      toast(`偵測到 ${ago} 分鐘前的未儲存草稿`, {
        action: {
          label: '還原',
          onClick: () => {
            form.reset(values);
            flashStatus('restoring');
          },
        },
        duration: 8000,
      });
    } catch { /* 損毀的 JSON 等 — 忽略 */ }
  }, [autosaveKey, form, id, flashStatus]);

  // ── Zen 模式：F11 / Esc 切換 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') { e.preventDefault(); setZenMode(z => !z); }
      else if (e.key === 'Escape' && zenMode) setZenMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zenMode]);

  // Zen 模式時隱藏 admin 側欄與 header（透過 body class）
  // 切換完 dispatch resize 讓 Monaco 重新計算尺寸（automaticLayout 監聽 ResizeObserver）
  useEffect(() => {
    document.body.classList.toggle('zen-mode-active', zenMode);
    // 等下一個 frame，確保 CSS 套用完才觸發 resize
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 350);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('zen-mode-active');
    };
  }, [zenMode]);

  // 編輯模式：query 取回文章後填入 RHF 表單（excerpt* → summary*、tags 格式化、各 locale 同步）。
  useEffect(() => {
    if (!postData) return;
    const formattedData = {
      ...postData,
      tags: formatTags(postData.tags),
      summary: postData.excerpt ?? '',
      source_language: postData.source_language ?? 'zh-TW',
      title_en: postData.title_en ?? '', content_en: postData.content_en ?? '', summary_en: postData.excerpt_en ?? '',
      title_zh_cn: postData.title_zh_cn ?? '', content_zh_cn: postData.content_zh_cn ?? '', summary_zh_cn: postData.excerpt_zh_cn ?? '',
      title_ja: postData.title_ja ?? '', content_ja: postData.content_ja ?? '', summary_ja: postData.excerpt_ja ?? '',
      title_ko: postData.title_ko ?? '', content_ko: postData.content_ko ?? '', summary_ko: postData.excerpt_ko ?? '',
      allow_comments: postData.allow_comments,
      series_name: postData.series_name ?? '',
      series_order: postData.series_order ?? '',
      send_newsletter: false,
    };
    form.reset(formattedData as PostFormInput);
    // 載入既有文章 → 把編輯器狀態同步成該篇的值。資料是非同步來的，render 期沒有。
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setActiveLocale(postData.source_language ?? 'zh-TW');
    // reset 完成 → 讓下方 Select 依 key 重新 mount、以正確值初始化（此 set-state 是刻意的）
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setHydrated(true);
    // 只跟著 postData 跑：form 是 react-hook-form 的實例，進依賴會讓每次 render 都重灌表單。
    // （原本的 react-hooks/ 命名空間在換 oxlint 後已失效。）
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [postData]);

  // 從 URL 參數載入 N8N 自動匯入的資料
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const n8nData = urlParams.get('n8n_data');
    
    if (n8nData && !id) {
      try {
        const parsedData = JSON.parse(decodeURIComponent(n8nData)) as N8NData;
        handleN8NImport(parsedData);
      } catch (error) {
        console.error('解析 N8N 資料失敗:', error);
        toast.error('匯入資料格式錯誤');
      }
    }
    // 刻意只跑一次：n8n_data 是開啟編輯器當下網址帶進來的一次性匯入資料，
    // 重跑會把使用者後續的編輯整個蓋掉。
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, []);

  /**
   * 處理 N8N 自動匯入的資料
   */
  const handleN8NImport = (n8nData: N8NData) => {
    // 驗證必填欄位
    if (!n8nData.title || !n8nData.content) {
      toast.error('N8N 資料缺少必填欄位 (title 或 content)');
      return;
    }

    // 轉換標籤格式
    const formattedTags = formatTags(n8nData.tags);

    // 自動生成 slug（如果沒有）
    const slug = n8nData.slug ?? generateSlugFromTitle(n8nData.title);

    // 提取摘要（如果沒有）
    const summary = n8nData.summary ?? extractSummary(n8nData.content);

    // 填充表單
    form.reset({
      title: n8nData.title,
      content: n8nData.content,
      tags: formattedTags,
      category: n8nData.category ?? '',
      slug: slug,
      summary: summary,
      cover: n8nData.cover ?? '',
      status: n8nData.status ?? 'draft',
      layout_type: n8nData.layout_type ?? 'record',
      allow_comments: n8nData.allowComments !== false && n8nData.allow_comments !== false,
      send_newsletter: false,
    });

    toast.success('已成功匯入 N8N 資料');
  };

  /**
   * 格式化標籤數據
   * 支援多種輸入格式：
   * 1. 字串陣列: ["React", "TypeScript"]
   * 2. 物件陣列: [{label: "React", value: "1"}]
   * 3. 混合格式
   */
  const formatTags = (tags: unknown): TagOption[] => {
    if (!Array.isArray(tags)) {
      return [];
    }

    return (tags as unknown[]).map((tag, index) => {
      // 如果是字串，轉換為物件格式
      if (typeof tag === 'string') {
        return {
          label: tag,
          value: tag.toLowerCase().replace(/\s+/g, '-'),
        };
      }
      // 如果已經是物件，確保有 label 和 value
      if (tag && typeof tag === 'object') {
        const t = tag as { label?: string; name?: string; value?: string; id?: number | string };
        return {
          label: t.label ?? t.name ?? `Tag ${index + 1}`,
          value: t.value ?? t.id?.toString() ?? `tag-${index}`,
        };
      }
      // 預設值
      return {
        label: `Tag ${index + 1}`,
        value: `tag-${index}`,
      };
    });
  };

  /**
   * 從標題生成 slug
   */
  const handleSendNewsletter = async () => {
    if (!confirm('要立即推送這篇文章給所有訂閱者嗎？')) return;
    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const res = await fetch(`/api/admin/posts/${id}/send-newsletter`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { error?: string; sent?: number; failed?: number };
      if (!res.ok) {
        toast.error(data.error ?? '推送失敗');
        return;
      }
      toast.success(`已寄出 ${data.sent} 封，失敗 ${data.failed}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '推送失敗');
    }
  };

  const generateSlugFromTitle = (title: string) => {
    if (!title) return '';
    
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s\u4e00-\u9fa5-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  /**
   * 從內容提取摘要
   */
  const extractSummary = (content: string, maxLength = 150) => {
    if (!content) return '';
    
    const plainText = content
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*|\*|__|_/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/>\s/g, '')
      .replace(/[-*+]\s/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    return plainText.length > maxLength 
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  };

  // 將表單 data 轉成送往 API 的 payload（包含 i18n 欄位，並把 summary* 對應到 excerpt*）
  const buildPayload = (data: PostFormInput, overrides: Record<string, unknown> = {}) => {
    const tagsArray = Array.isArray(data.tags)
      ? data.tags.map(tag => typeof tag === 'string' ? tag : tag.label)
      : [];
    const {
      summary, summary_en, summary_zh_cn, summary_ja, summary_ko,
      ...rest
    } = data;
    return {
      ...rest,
      excerpt: summary,
      excerpt_en: summary_en,
      excerpt_zh_cn: summary_zh_cn,
      excerpt_ja: summary_ja,
      excerpt_ko: summary_ko,
      tags: tagsArray,
      ...overrides,
    };
  };

  const onSaveDraft = async (data: PostFormInput, opts: { exit?: boolean } = {}) => {
    if (submitLockRef.current) {
      toast.info('正在儲存中，請稍候');
      return;
    }
    submitLockRef.current = true;
    setIsSavingDraft(true);
    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const url = id ? `/api/admin/posts/${id}` : '/api/admin/posts';
      const method = id ? 'PUT' : 'POST';
      const payload = buildPayload(data, { status: 'draft' });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast.success('草稿已儲存');
        try { localStorage.removeItem(autosaveKey); } catch { /* ignore */ }
        const result = await response.json() as { data?: { id?: string | number }; id?: string | number };
        // 後端 create 回 { data: { id } }；沒抓到就會每次都 POST → 重複建立草稿
        const newId = result.data?.id ?? result.id;
        if (opts.exit) {
          void navigate('/admin/posts'); // 「存並回列表」：存完直接回列表
        } else if (!id && newId) {
          void navigate(`/admin/posts/edit/${newId}`); // 新草稿存完換到 edit 網址（避免重複建立）
        }
      } else {
        toast.error('儲存失敗');
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      toast.error('儲存失敗');
    } finally {
      setIsSavingDraft(false);
      submitLockRef.current = false;
    }
  };

  const onPublish = async (data: PostFormInput) => {
    if (submitLockRef.current) {
      toast.info('正在處理中，請稍候');
      return;
    }
    submitLockRef.current = true;
    setIsPublishing(true);
    try {
      const token = localStorage.getItem('koimsurai_user_token');
      const url = id ? `/api/admin/posts/${id}` : '/api/admin/posts';
      const method = id ? 'PUT' : 'POST';
      const payload = buildPayload(data, { status: 'published' });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast.success('文章已發佈');
        // 若有勾「發佈時推送 Newsletter」，後端會在 data.newsletter 回寄送結果
        try {
          const body = await response.json() as {
            data?: { newsletter?: { sent?: number; failed?: number; error?: string } };
          };
          const nl = body.data?.newsletter;
          if (nl?.error) toast.error(`電子報寄送失敗：${nl.error}`);
          else if (nl) toast.success(`電子報已寄出 ${nl.sent ?? 0} 封，失敗 ${nl.failed ?? 0}`);
        } catch { /* 回應非 JSON 不影響發佈成功 */ }
        try { localStorage.removeItem(autosaveKey); } catch { /* ignore */ }
        void navigate('/admin/posts');
      } else {
        toast.error('發佈失敗');
      }
    } catch (error) {
      console.error('發佈失敗:', error);
      toast.error('發佈失敗');
    } finally {
      setIsPublishing(false);
      submitLockRef.current = false;
    }
  };

  // ── OpenCC：由 zh-TW 自動產生简体中文（純字詞轉換，不丟 LLM） ──
  const handleGenerateZhCN = async () => {
    if (!id) {
      toast.error('請先儲存草稿，取得文章 ID 後再執行');
      return;
    }
    if (sourceLanguage !== 'zh-TW') {
      toast.error('只能從 zh-TW 原文自動產生简体中文');
      return;
    }
    const existing = form.getValues('title_zh_cn') ?? form.getValues('content_zh_cn');
    if (existing && !window.confirm('已有简体中文內容，要覆蓋嗎？')) return;

    setIsGeneratingZhCN(true);
    try {
      const token = localStorage.getItem('koimsurai_user_token');
      // 先把最新的 zh-TW 原文存一次，讓 OpenCC 以最新內容轉換
      await fetch(`/api/admin/posts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload(form.getValues())),
      });

      const res = await fetch(`/api/admin/posts/${id}/generate-zh-cn`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `API 錯誤 (${res.status})`);
      }
      const data = await res.json() as { title_zh_cn?: string; content_zh_cn?: string; excerpt_zh_cn?: string };
      form.setValue('title_zh_cn', data.title_zh_cn ?? '');
      form.setValue('content_zh_cn', data.content_zh_cn ?? '');
      form.setValue('summary_zh_cn', data.excerpt_zh_cn ?? '');
      toast.success('简体中文已生成（OpenCC 繁轉簡）');
      setActiveLocale('zh-CN');
    } catch (e) {
      console.error('OpenCC 生成失敗:', e);
      toast.error(`生成失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsGeneratingZhCN(false);
    }
  };

  // ── AI 摘要生成（獨立功能，可用於手動寫的文章） ──
  const handleGenerateSummary = async () => {
    // 依 activeLocale 生成對應語言的摘要，並以該 locale 的 title/content 作為輸入
    const title = form.getValues(titleName);
    const content = form.getValues(contentName);

    if (!content || content.trim().length < 50) {
      toast.error('文章內容太短，無法生成摘要');
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const response = await fetch('/llm-api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `你是一個部落格文章元資料生成器。請以 ${activeLocale} 撰寫，根據提供的文章內容產生：
1. summary：120-220 字（或對應語言的合適長度）的文章摘要，以第三人稱視角撰寫，聚焦文章主軸，不腦補不存在的內容。風格簡潔、資訊密度高。
2. tags：3-8 個相關標籤，每個標籤是簡短的關鍵詞（如 React、Docker、CSS 等）。

回傳嚴格的 JSON 格式：
{
  "summary": "摘要文字",
  "tags": ["標籤1", "標籤2", "標籤3"]
}

只回傳 JSON，不要其他文字。`,
            },
            {
              role: 'user',
              content: `文章標題：${title ?? '未命名'}\n\n文章內容：\n${content.substring(0, 8000)}`,
            },
          ],
          max_tokens: 512,
          temperature: 0.3,
        }),
      });

      if (!response.ok) throw new Error(`API 錯誤 (${response.status})`);

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const resultText = data.choices?.[0]?.message?.content ?? '';

      let parsed: { summary?: string; tags?: string[] } | undefined;
      try {
        parsed = JSON.parse(resultText) as { summary?: string; tags?: string[] };
      } catch {
        const match = /(\{[\s\S]*\})/.exec(resultText);
        if (match) {
          try { parsed = JSON.parse(match[1]) as { summary?: string; tags?: string[] }; } catch { /* fallback */ }
        }
      }

      if (parsed?.summary) {
        form.setValue(summaryName, parsed.summary);
        toast.success(`摘要已生成（${activeLocale}）`);

        // 如果 AI 也回傳了標籤，且目前標籤為空，則自動填入
        if ((parsed.tags?.length ?? 0) > 0) {
          const currentTags = form.getValues('tags') ?? [];
          if (currentTags.length === 0) {
            const formattedTags = (parsed.tags ?? []).map(t => ({
              label: t,
              value: t.toLowerCase().replace(/\s+/g, '-'),
            }));
            form.setValue('tags', formattedTags);
            toast.info(`同時生成了 ${formattedTags.length} 個標籤建議`);
          }
        }
      } else {
        toast.error('AI 回傳格式異常，請重試');
      }
    } catch (err) {
      console.error('AI 摘要生成失敗:', err);
      toast.error(`摘要生成失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-transparent"></div>
          <p className="mt-4 text-muted-foreground">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        <Form {...form}>
          <form className="flex flex-1 min-h-0">
            {/* Hidden buttons for AdminLayout header to trigger */}
            <button
              id="save-draft-btn"
              aria-hidden tabIndex={-1}
              type="button"
              className="hidden"
              disabled={isSavingDraft || isPublishing}
              onClick={(e) => { void form.handleSubmit((d) => onSaveDraft(d), () => toast.error('請先填寫標題與內容'))(e); }}
            />
            <button
              id="save-exit-btn"
              aria-hidden tabIndex={-1}
              type="button"
              className="hidden"
              disabled={isSavingDraft || isPublishing}
              onClick={(e) => { void form.handleSubmit((d) => onSaveDraft(d, { exit: true }), () => toast.error('請先填寫標題與內容'))(e); }}
            />
            <button
              id="publish-btn"
              aria-hidden tabIndex={-1}
              type="button"
              className="hidden"
              disabled={isSavingDraft || isPublishing}
              onClick={(e) => { void form.handleSubmit(onPublish, () => toast.error('請先填寫標題與內容'))(e); }}
            />
            {/* Left Column - Editor */}
            <main className="flex-1 overflow-y-auto p-6 min-w-0 space-y-0">
                {/* Locale tabs */}
                <div className="mb-4 flex items-center gap-1 rounded-lg border border-border/40 bg-accent/10 p-1">
                  <Languages className="mx-2 h-3.5 w-3.5 text-muted-foreground/70" />
                  {LOCALE_TABS.map(t => {
                    const isSource = t.code === sourceLanguage;
                    const titleVal = form.watch(fieldNameFor('title', t.code, sourceLanguage));
                    const hasContent = !!titleVal?.trim();
                    return (
                      <button
                        key={t.code}
                        type="button"
                        onClick={() => setActiveLocale(t.code)}
                        className={`relative rounded px-2.5 py-1 text-xs transition-colors ${
                          activeLocale === t.code
                            ? 'bg-accent/70 text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                        }`}
                      >
                        {t.label}
                        {isSource && (
                          <span className="ml-1 rounded bg-violet-500/20 px-1 py-[1px] text-[9px] text-violet-300">原文</span>
                        )}
                        {!isSource && hasContent && (
                          <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        )}
                      </button>
                    );
                  })}
                  {sourceLanguage === 'zh-TW' && (
                    <button
                      type="button"
                      onClick={() => { void handleGenerateZhCN(); }}
                      disabled={isGeneratingZhCN}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      title="OpenCC 繁→簡，純字詞轉換不丟 LLM"
                    >
                      {isGeneratingZhCN ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                      自動產生简中
                    </button>
                  )}
                </div>

                {/* i18n 多語系提示 */}
                <p className="mb-3 text-[11px] text-muted-foreground/70">
                  目前編輯：<span className="text-violet-300">{LOCALE_TABS.find(t => t.code === activeLocale)?.label}</span>
                  <span className="mx-1.5 opacity-40">·</span>
                  所有已填語系會一起儲存／發佈，不需分別操作
                </p>

                {/* Title (per-locale) — 直接用 form.watch/setValue，避免 FormField 動態 name 的 bug */}
                <input
                  key={`title-${activeLocale}`}
                  value={titleValue}
                  onChange={(e) => form.setValue(titleName, e.target.value, { shouldDirty: true })}
                  placeholder="輸入文章標題..."
                  className="w-full bg-transparent text-foreground/90 text-lg font-medium mb-5 pb-3 border-b border-border/30 outline-none focus:border-border transition-colors"
                />

                {/* Content (per-locale) - 玻璃擬態編輯器 */}
                <div className="glass rounded-xl overflow-hidden border border-border/50">
                  <div className="flex items-center gap-1 border-b border-border/40 bg-accent/20 px-2 py-1.5">
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs transition-colors ${editorView === 'edit' ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
                      onClick={() => setEditorView('edit')}
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs transition-colors ${editorView === 'split' ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
                      onClick={() => setEditorView('split')}
                    >
                      分割
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs transition-colors ${editorView === 'preview' ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
                      onClick={() => setEditorView('preview')}
                    >
                      預覽
                    </button>
                    <div className="ml-auto flex items-center gap-2">
                      {autosaveStatus === 'saved' && (
                        <span className="text-[10px] text-emerald-400/80 animate-in fade-in">已自動備份</span>
                      )}
                      {autosaveStatus === 'restoring' && (
                        <span className="text-[10px] text-violet-300 animate-in fade-in">已還原草稿</span>
                      )}
                      <button
                        type="button"
                        title={zenMode ? '退出 Zen（Esc）' : 'Zen 模式（F11）'}
                        onClick={() => setZenMode(z => !z)}
                        className="rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                      >
                        {zenMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                      </button>
                    </div>
                  </div>

                  {editorView !== 'preview' && (
                    <MonacoEditor
                      key={`monaco-${activeLocale}`}
                      path={`post.${activeLocale}.md`}
                      value={contentValue}
                      onChange={(v) => form.setValue(contentName, v ?? '', { shouldDirty: true })}
                      language="markdown"
                      height={editorView === 'split' ? '360px' : '700px'}
                      theme="vs-dark"
                      onSave={() => { void form.handleSubmit((d) => onSaveDraft(d), () => toast.error('請先填寫標題與內容'))(); }}
                    />
                  )}

                  {editorView !== 'edit' && (
                    <div className={`${editorView === 'split' ? 'max-h-[340px]' : 'max-h-[700px]'} overflow-y-auto border-t border-border/40 bg-background/70 p-4`}>
                      {/* 跟前台同一套渲染（MDX blocks / shiki / alert / 連結卡）→ 所見即所得 */}
                      <PostPreview content={contentValue} format={format} />
                    </div>
                  )}
                </div>
            </main>

            {/* Right Column - Settings */}
            <aside className="w-[280px] border-l border-border/30 glass-subtle shrink-0 hidden lg:block overflow-y-auto">
              <div className="p-4 space-y-5">
                {/* Category & Tags */}
                <div>
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-3 flex items-center gap-2">
                    <Folder className="h-3.5 w-3.5" />
                    分類與標籤
                  </h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">
                            分類
                          </FormLabel>
                          <Select
                            // hydrated + categories.length 進 key：載入完成或選項到齊時重新 mount，
                            // 讓觸發器顯示已載入的分類（Radix Select 不反映 mount 後才變的受控值）。
                            key={`category-${hydrated ? 'r' : 'i'}-${categories.length}`}
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 bg-accent/30">
                                <SelectValue placeholder="選擇分類" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map((cat) => (
                                <SelectItem key={cat.id} value={cat.name}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="tags"
                      render={({ field }) => {
                        const selectedTags = field.value ?? [];
                        return (
                          <FormItem>
                            <FormLabel className="text-xs text-muted-foreground">
                              標籤
                              <span className="text-muted-foreground/50 ml-1">({tags.length} 個可用)</span>
                            </FormLabel>
                            <div className="text-[11px] text-muted-foreground/60 mb-1">
                              已選擇 {selectedTags.length} 項
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {selectedTags.map((tag) => (
                                <span
                                  key={tag.value}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/60 text-foreground/70 text-[11px] border border-border/40"
                                >
                                  {tag.label}
                                  <button
                                    type="button"
                                    onClick={() => field.onChange(selectedTags.filter(t => t.value !== tag.value))}
                                    className="hover:text-foreground transition-colors ml-0.5"
                                  >
                                    <X className="size-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <FormControl>
                              <TagSearchInput
                                tags={tags}
                                selectedTags={selectedTags}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  </div>
                </div>

                {/* Series — 系列文 */}
                <div>
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-3 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    系列文（選填）
                  </h3>
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="series_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">系列名稱</FormLabel>
                          <FormControl>
                            <input
                              {...field}
                              placeholder="如：Rust 學習筆記"
                              className="h-8 w-full rounded-md bg-accent/30 px-2 text-sm outline-none focus:bg-accent/50 transition-colors"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="series_order"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">順序（數字越小越前面）</FormLabel>
                          <FormControl>
                            <input
                              type="number"
                              {...field}
                              placeholder="例：1"
                              className="h-8 w-full rounded-md bg-accent/30 px-2 text-sm outline-none focus:bg-accent/50 transition-colors"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Publishing Options */}
                <div>
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-3 flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    發佈設定
                  </h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">
                            狀態
                          </FormLabel>
                          <Select
                            key={`status-${hydrated ? 'r' : 'i'}`}
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 bg-accent/30">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="draft">草稿</SelectItem>
                              <SelectItem value="published">已發佈</SelectItem>
                              <SelectItem value="archived">已封存</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="source_language"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Languages className="h-3 w-3" />
                            原文語言
                          </FormLabel>
                          <Select
                            key={`srclang-${hydrated ? 'r' : 'i'}`}
                            onValueChange={(v) => {
                              field.onChange(v);
                              if (activeLocale === sourceLanguage) setActiveLocale(v);
                            }}
                            value={field.value ?? 'zh-TW'}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 bg-accent/30">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="zh-TW">繁體中文</SelectItem>
                              <SelectItem value="zh-CN">简体中文</SelectItem>
                              <SelectItem value="en">English</SelectItem>
                              <SelectItem value="ja">日本語</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="slug"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">
                            網址 slug
                          </FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="blog-post-rendering-strategy" className="h-8 bg-accent/30" />
                          </FormControl>
                          <p className="text-[10px] text-muted-foreground/60">
                            文章網址是 /blog/&lt;slug&gt;。留空會自動從英文標題產生；改了也不會斷——舊網址會自動 301 到新的。
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="layout_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <LayoutTemplate className="h-3 w-3" />
                            樣板類型
                          </FormLabel>
                          <Select
                            key={`layout-${hydrated ? 'r' : 'i'}`}
                            onValueChange={field.onChange}
                            value={field.value ?? 'record'}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 bg-accent/30">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="record">📅 紀錄（時效性）</SelectItem>
                              <SelectItem value="column">💎 專欄（無時間性）</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="allow_comments"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <FormLabel className="text-xs text-muted-foreground">
                            允許留言
                          </FormLabel>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Newsletter trigger — auto-broadcast on publish */}
                    <FormField
                      control={form.control}
                      name="send_newsletter"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div className="flex flex-col gap-0.5">
                            <FormLabel className="text-xs text-muted-foreground">
                              發佈時推送 Newsletter
                            </FormLabel>
                            <span className="text-[10px] text-muted-foreground/60">
                              文章狀態為「已發佈」時才會觸發
                            </span>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Manual broadcast — only for already-published posts */}
                    {id && form.watch('status') === 'published' && (
                      <button
                        type="button"
                        className="w-full mt-1 px-3 py-2 text-xs rounded-md border border-violet-500/30 bg-violet-500/8 text-violet-200 hover:bg-violet-500/15 hover:border-violet-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isSavingDraft || isPublishing}
                        onClick={() => { void handleSendNewsletter(); }}
                      >
                        立即推送 Newsletter
                      </button>
                    )}
                  </div>
                </div>

                {/* Cover Image */}
                <div>
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-3 flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5" />
                    封面圖片
                  </h3>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="cover"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">
                            圖片網址
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="https://example.com/image.jpg"
                              className="h-8 bg-accent/30"
                            />
                          </FormControl>
                          {field.value && (
                            <div className="mt-2 rounded-lg overflow-hidden border">
                              <img
                                src={field.value}
                                alt="封面預覽"
                                className="w-full h-auto"
                              />
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                          摘要 <span className="text-muted-foreground/50">({activeLocale})</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => { void handleGenerateSummary(); }}
                          disabled={isGeneratingSummary}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingSummary ? (
                            <><Loader2 className="size-3 animate-spin" />生成中...</>
                          ) : (
                            <><Sparkles className="size-3" />AI 生成</>
                          )}
                        </button>
                      </div>
                      <textarea
                        key={`summary-${activeLocale}`}
                        value={summaryValue}
                        onChange={(e) => form.setValue(summaryName, e.target.value, { shouldDirty: true })}
                        placeholder="文章摘要（點擊右上角 AI 生成或手動輸入）..."
                        rows={4}
                        className="w-full bg-accent/30 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground/90 placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-border/60 transition-colors mt-1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </form>
        </Form>
      </div>
    </>
  );
}
