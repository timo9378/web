import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
    Sparkles,
    Copy,
    Check,
    Send,
    FileText,
    RotateCcw,
    RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';

// ─── Prompt 模板 ─────────────────────────────
const ARTICLE_TYPES = {
    tech: {
        label: '技術文章',
        emoji: '🛠',
        description: '開發筆記、踩坑紀錄、技術探索',
        systemPrompt: `你是一位經驗豐富的技術寫手，風格簡潔、重視個人觀點與細膩的日常文字。

## 核心原則 — 絕對不可違反
- **禁止虛構**：絕對不要編造任何對話、事件、或素材中不存在的情節。只能使用素材中明確出現的內容
- **禁止說教**：你不是在教讀者，而是在分享自己的探索過程。永遠不要用「你應該」「你可以」「讓我們」這類語氣
- **素材中的 User 就是作者本人**：當素材是對話紀錄時，User 說的話代表作者在提問或探索，不是在教 AI 東西。要如實反映「我當時在查什麼、問了什麼、最後搞懂了什麼」
- **忠於素材**：文章內容必須完全基於素材。如果素材中作者在問問題，就寫「我研究了...」「我試著搞清楚...」，而不是假裝作者在教別人

## 寫作風格
- 完全第一人稱，像在跟朋友聊天般自然
- 技術深度與個人感受交織 — 「我在做什麼、遇到了什麼、怎麼想的」
- 段落精短（每段 2-4 句），善用 Markdown 標題分層
- 遇到踩坑或有趣的地方可以適度吐槽，保持輕鬆語氣
- 結尾自然收束，**不要寫「總結」「結語」之類的段落**
- 程式碼區塊標注語言，搭配簡短說明

## 格式要求
- 回傳純 Markdown
- 第一行是文章標題（# 開頭）
- 標題下方空一行後開始正文
- 適度使用小標題 (##) 和程式碼區塊
- 不要在結尾加上 --- 分隔線或 meta 資訊`,
    },
    review: {
        label: '影集 / 電影心得',
        emoji: '🎬',
        description: '觀後感、劇情分析、推薦',
        systemPrompt: `你是一位具有獨特品味的影評寫手，風格簡潔、重視個人觀點與細膩的日常文字。

## 核心原則 — 絕對不可違反
- **禁止虛構**：絕對不要編造任何觀影經歷、場景描述、或素材中不存在的內容
- **禁止說教**：不是在推薦或評論給讀者看，而是在記錄自己的感受
- **忠於素材**：只描寫素材中實際提到的劇情、角色、感受

## 寫作風格
- 第一人稱、感性敘事，像寫日記般真誠
- 不劇透過多，但會分享自己最有感觸的場景或台詞
- 觀感與個人生活經歷連結 — 為什麼這部作品打動你
- 可以談畫面、音樂、節奏、角色塑造，但要有個人觀點而非泛泛而談
- 語氣可以偶爾幽默，但整體保持溫暖
- 結尾自然，不寫「推薦指數」「評分」這類東西

## 格式要求
- 回傳純 Markdown
- 第一行是文章標題（# 開頭）
- 標題下方空一行後開始正文
- 可以適度引用台詞（用 > 引用格式）
- 不要在結尾加上 --- 分隔線或 meta 資訊`,
    },
    reflection: {
        label: '生活隨筆',
        emoji: '☕',
        description: '心得感想、日常記錄、碎碎念',
        systemPrompt: `你是一位善於捕捉日常細節的文字工作者，風格簡潔、重視個人觀點與細膩的日常文字。

## 核心原則 — 絕對不可違反
- **禁止虛構**：絕對不要編造任何事件、對話、或素材中不存在的情節。只能寫素材中有的東西
- **禁止說教**：不要寫「也許你也有過這種感覺」「希望每個人都能...」這類句子。這是私人日記，不是給讀者的忠告
- **忠於素材**：如果素材是對話紀錄，要理解 User 是在表達自己的想法或提問，如實記錄這些思考過程

## 寫作風格
- 第一人稱、散文體，像在自言自語
- 從一個小事件或感受出發，自然延伸到更深的思考
- 不說教、不雞湯，只是誠實地記錄自己的狀態和想法
- 句子可長可短，追求節奏感而非工整
- 偶爾加入環境描寫或感官細節，增加畫面感
- 結尾留白，不下結論

## 格式要求
- 回傳純 Markdown
- 第一行是文章標題（# 開頭）
- 標題下方空一行後開始正文
- 段落之間用空行隔開
- 不要在結尾加上 --- 分隔線或 meta 資訊`,
    },
    monthly: {
        label: '月記風格',
        emoji: '📅',
        description: '類似月度回顧的記錄體',
        systemPrompt: `你是這個人的個人 AI 助理，正在幫他撰寫月度回顧手記。風格簡潔、重視個人觀點與細膩的日常文字。

## 核心原則 — 絕對不可違反
- **禁止虛構**：絕對不要編造任何不在素材中的事件、對話、經歷。寧可少寫也不要瞎編
- **禁止說教**：這是私人回顧，不需要給讀者任何建議或啟發
- **忠於素材**：素材中 User 的發言代表作者本人的經歷和想法，要如實反映

## 寫作風格
- 第一人稱，溫暖但不做作
- 以時間線或主題為軸，回顧這段時間發生的事
- 不是流水帳 — 挑有感觸的事來寫，加入個人反思
- 可以談工作、技術、生活、貓、心情、追劇等任何面向
- 語氣像是寫給未來的自己看的筆記
- 結尾可以展望下個月，但要自然

## 格式要求
- 回傳純 Markdown
- 第一行是文章標題（# 開頭）
- 標題下方空一行後開始正文
- 善用 ## 小標題分段（例如：工作、生活、心境）
- 不要在結尾加上 --- 分隔線或 meta 資訊`,
    },
};

// ─── LLM API 呼叫 ──────────────────────────────────────
const MAX_INPUT_CHARS = 50000;
const LLM_TIMEOUT_MS = 180_000;  // 3 分鐘
const CONTEXT_BRIDGE_CHARS = 300;

interface LLMMessage { role: string; content: string }
interface OutlineSection { heading?: string; brief?: string }
interface Outline { sections?: OutlineSection[] }

async function fetchLLM(messages: LLMMessage[], { maxTokens = 4096, temperature = 0.75 }: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    try {
        const payload = {
            model: 'gpt-4o',
            messages,
            max_tokens: maxTokens,
            temperature,
        };

        console.log('[ArticleGen] fetchLLM:', { maxTokens, temperature, msgCount: messages.length, totalChars: messages.reduce((a, m) => a + m.content.length, 0) });

        const response = await fetch('/llm-api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error('[ArticleGen] API error:', response.status, errText.slice(0, 500));
            throw new Error(`LLM API 錯誤 (${response.status}): ${errText.slice(0, 200)}`);
        }

        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content ?? '';
        console.log('[ArticleGen] Got response:', content.length, 'chars');
        return content;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error('請求逾時（超過 3 分鐘），請嘗試縮短素材長度後重試');
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function trimMaterial(text: string) {
    if (text.length <= MAX_INPUT_CHARS) return text;
    // 保留頭部 40K + 尾部 8K  → 共 48K
    const head = text.slice(0, 40000);
    const tail = text.slice(-8000);
    return `${head}\n\n[...中間省略約 ${(text.length - 48000).toLocaleString()} 字...]\n\n${tail}`;
}

function cleanSectionOutput(text: string) {
    let t = text.trim();
    if (t.startsWith('```')) {
        t = t.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');
    }
    return t.trim();
}

/**
 * 多階段長文生成：大綱 → 逐段展開
 */
async function generateLongForm(systemPrompt: string, userContent: string, guide: string, onProgress?: (msg: string) => void, onLog?: (msg: string) => void): Promise<string> {
    const material = trimMaterial(userContent);
    onLog?.(`📝 Material trimmed length: ${material.length}`);

    // ── Phase 1：生成大綱 ────────────────────────────────
    onProgress?.('📐 正在規劃文章結構...');
    onLog?.('🚀 Phase 1: Generating Outline...');

    const outlineSystem = `${systemPrompt}\n\n` +
        '## 本次任務：產出文章大綱\n\n' +
        '請根據素材規劃文章結構，回傳 JSON：\n' +
        '```json\n' +
        '{\n' +
        '  "sections": [\n' +
        '    {\n' +
        '      "heading": "二級標題（不含 ## 符號，第一段可留空字串作為開場段）",\n' +
        '      "brief": "這段要涵蓋的重點摘要（50-100 字）"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '```\n\n' +
        'Rules:\n' +
        '- sections count 6-10, depending on material richness\n' +
        '- brief for each section must be specific enough, mentioning UNIQUE details only covered in that section\n' +
        '- First section starts with natural opening (heading empty "")\n' +
        '- Last section can be reflection or outlook, but do NOT name it "Summary"\n' +
        '- Do NOT merge different topics into one section\n' +
        '- **CRITICAL: Each section must cover a DISTINCT topic/aspect. No two sections should overlap in content or theme.**\n' +
        '- **Each brief must clearly differentiate what THIS section covers vs others — no vague or shared descriptions**\n' +
        '- If a detail appears in one section brief, it must NOT appear in any other section brief\n';

    const outlineMessages: LLMMessage[] = [
        { role: 'system', content: outlineSystem },
    ];
    if (guide.trim()) {
        outlineMessages.push({ role: 'system', content: `## 導演指令（優先遵守）\n${guide.trim()}` });
    }
    outlineMessages.push({
        role: 'user',
        content: `以下是素材，請產出文章大綱：\n\n---\n${material}\n---`,
    });

    const outlineRaw = await fetchLLM(outlineMessages, { maxTokens: 1024, temperature: 0.5 });
    onLog?.(`📄 Outline Raw: ${outlineRaw.slice(0, 100)}...`);
    console.log('[ArticleGen] Outline raw:', outlineRaw.slice(0, 300));
    let outline: Outline | undefined;
    try {
        outline = JSON.parse(outlineRaw) as Outline;
    } catch {
        const match = /(\{[\s\S]*\})/.exec(outlineRaw);
        if (match) {
            try { outline = JSON.parse(match[1]) as Outline; } catch { /* fallback */ }
        }
    }

    const sections = outline?.sections;

    // 段數不足 → 退回單次生成
    if (!sections || sections.length < 4) {
        onProgress?.('✍️ 素材較少，使用單次生成...');
        onLog?.('⚠️ Outline parse failed or too few sections, falling back to single pass.');
        const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];
        if (guide.trim()) {
            messages.push({ role: 'system', content: `## 導演指令（優先遵守）\n${guide.trim()}` });
        }
        messages.push({
            role: 'user',
            content: `以下是素材，請撰寫文章：\n\n---\n${material}\n---`,
        });
        return await fetchLLM(messages, {});
    }

    onProgress?.(`📐 大綱完成：${sections.length} 個段落`);
    onLog?.(`✅ Outline parsed: ${sections.length} sections`);

    // ── Phase 2：逐段展開 ────────────────────────────────
    const outlineSummary = sections.map((s, i) =>
        `${i + 1}. ${s.heading ?? '（開場段）'}：${s.brief ?? ''}`
    ).join('\n');

    const allParts: string[] = [];
    let previousTail = '';
    const completedHeadings: { heading: string; brief: string }[] = [];

    for (let idx = 0; idx < sections.length; idx++) {
        const section = sections[idx];
        const isFirst = idx === 0;
        const isLast = idx === sections.length - 1;
        const heading = section.heading ?? '';
        const brief = section.brief ?? '';

        const positionDesc = isFirst
            ? '文章開頭（含自然開場段）'
            : isLast
                ? '文章結尾段落'
                : `文章中段（第 ${idx + 1}/${sections.length} 段）`;

        onProgress?.(`✍️ 正在展開第 ${idx + 1}/${sections.length} 段：${heading || '開場段'}...`);
        onLog?.(`🚀 Expanding Section ${idx + 1}/${sections.length}: ${heading}`);

        let expandSystem = `${systemPrompt}\n\n` +
            `## 本次任務：展開「${heading || '開場段'}」\n\n` +
            `你正在撰寫一篇完整文章的 **${positionDesc}**。\n\n` +
            `文章完整大綱：\n${outlineSummary}\n\n` +
            `本段的重點：${brief}\n\n`;

        if (completedHeadings.length > 0) {
            expandSystem += `## 已完成段落（嚴禁重複這些段落的內容）\n` +
                `以下段落已經寫完，你**絕對不可以**重複或改寫這些段落涵蓋的主題和細節：\n` +
                completedHeadings.map((h, i) => `${i + 1}. ${h.heading}：${h.brief}`).join('\n') + '\n\n';
        }

        expandSystem += '## 展開約束\n' +
            '- 回傳純 Markdown（不需要 JSON）\n';

        if (heading) expandSystem += `- 本段以 \`## ${heading}\` 開頭\n`;
        if (isFirst) {
            expandSystem += `- 這是文章開頭，用自然的第一人稱開場，你的標題是「${heading}」，請務必以 \`## ${heading}\` 作為第一行\n` +
                '- 寫完開場段後開始展開第一個主題\n';
        } else {
            expandSystem += '- **不要寫任何開場白、引言或重述文章主題**\n- 直接從段落內容開始\n- 延續上文的語氣和節奏\n';
        }
        if (isLast) {
            expandSystem += '- 這是文章最後一段，可以自然地帶入反思或展望\n- 但**不要寫「總結」「結語」標題**\n';
        } else {
            expandSystem += '- **不要在這段結尾做總結性收束**，文章還沒結束\n';
        }
        expandSystem += '- 篇幅充實但不注水(嚴禁腦補不存在的事件或細節)，這段應寫 600-1000 字\n' +
            '- 請深度挖掘細節（感官描寫、心理活動、環境氛圍）\n' +
            '- 禁止將多個不相關的主題合併在一段，若大綱有誤請專注於本段指定的一個主題\n' +
            '- 只使用素材中出現的事實\n' +
            '- **嚴禁與前面段落產生內容重疊**：如果某個觀點、事件、或技術細節已在前面段落出現過，此段不得再次提及或以不同措辭重述\n' +
            '- 每段專注挖掘大綱中指定的**獨立主題**，絕不回頭複述已寫過的內容\n';

        const expandMessages: LLMMessage[] = [{ role: 'system', content: expandSystem }];
        if (guide.trim()) {
            expandMessages.push({ role: 'system', content: `## 導演指令（優先遵守）\n${guide.trim()}` });
        }

        const userParts: string[] = [];
        if (previousTail) {
            userParts.push(`【上一段的結尾（銜接參考，嚴禁重複其內容）】：\n"""\n${previousTail}\n"""`);
        }
        userParts.push(`【本段可用素材】：\n---\n${material}\n---`);

        expandMessages.push({ role: 'user', content: userParts.join('\n\n') });

        const sectionText = await fetchLLM(expandMessages, { maxTokens: 2048, temperature: 0.7 });
        if (sectionText && !sectionText.startsWith('抱歉')) {
            const cleaned = cleanSectionOutput(sectionText);
            allParts.push(cleaned);
            previousTail = cleaned.slice(-CONTEXT_BRIDGE_CHARS);
            completedHeadings.push({ heading, brief });
        } else {
            onLog?.(`⚠️ Section ${idx + 1} failed or returned apology.`);
        }
    }

    if (allParts.length === 0) {
        throw new Error('所有段落展開都失敗了，請重試');
    }

    onProgress?.(`✅ 完成！共 ${allParts.length} 段`);
    onLog?.('🎉 All sections completed.');
    return allParts.join('\n\n');
}

// ─── 元件 ───────────────────────────────────────────────
export default function ArticleGenerator() {
    const navigate = useNavigate();
    const [conversationText, setConversationText] = useState('');
    const [articleType, setArticleType] = useState('tech');
    const [guide, setGuide] = useState('');
    const [generatedContent, setGeneratedContent] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [progressText, setProgressText] = useState('');
    const [viewMode, setViewMode] = useState('preview'); // 'preview' | 'source'
    const [copied, setCopied] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, `[${time}] ${msg}`]);
    };

    const selectedType = ARTICLE_TYPES[articleType as keyof typeof ARTICLE_TYPES];

    // ── 生成文章 ──
    const handleGenerate = async () => {
        if (!conversationText.trim()) {
            toast.error('請先貼上對話內容或素材');
            return;
        }

        setIsGenerating(true);
        setGeneratedContent('');
        setLogs([]); // Clear logs
        setProgressText('🔄 準備中...');
        addLog('🚀 Starting generation process...');

        if (conversationText.length > MAX_INPUT_CHARS) {
            const msg = `素材超過 ${(MAX_INPUT_CHARS / 1000).toFixed(0)}K 字，已自動保留頭尾重點`;
            toast.info(msg);
            addLog(`⚠️ ${msg}`);
        }

        try {
            const result = await generateLongForm(
                selectedType.systemPrompt,
                conversationText,
                guide,
                (progress) => setProgressText(progress),
                addLog // Pass logger
            );

            if (!result.trim()) {
                toast.error('LLM 回傳了空內容，請重試');
                addLog('❌ Error: Empty result from LLM');
                return;
            }

            setGeneratedContent(result);
            toast.success('文章已生成！');
            addLog('✅ Generation completed successfully.');
        } catch (err) {
            console.error('生成失敗:', err);
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`生成失敗：${message}`);
            addLog(`❌ Fatal Error: ${message}`);
        } finally {
            setIsGenerating(false);
            setProgressText('');
        }
    };

    // ── 複製到剪貼簿 ──
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(generatedContent);
            setCopied(true);
            toast.success('已複製到剪貼簿');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('複製失敗');
        }
    };

    // ── 匯入到文章編輯器 ──
    const handleSendToEditor = async () => {
        if (!generatedContent.trim()) return;

        // 從 Markdown 中提取標題
        const titleMatch = /^#\s+(.+)$/m.exec(generatedContent);
        const title = titleMatch ? titleMatch[1].trim() : '未命名文章';

        // 移除標題行，剩餘作為正文
        const content = generatedContent
            .replace(/^#\s+.+$/m, '')
            .trim();

        // 使用 AI 生成摘要與標籤（模仿 Jarvis 的 prompt）
        let summary = '';
        let tags: string[] = [];
        try {
            toast.info('正在使用 AI 生成摘要與標籤...');
            const metaResult = await fetchLLM([
                {
                    role: 'system',
                    content: `你是一個部落格文章元資料生成器。請根據提供的文章內容，生成：
1. summary：120-220 字的文章摘要，以第三人稱視角撰寫，聚焦文章主軸，不腦補不存在的內容。可直接用於 blog 後台摘要欄位。
2. tags：3-8 個相關標籤，每個標籤是簡短的關鍵詞。

回傳嚴格的 JSON 格式：
{
  "summary": "摘要文字",
  "tags": ["標籤1", "標籤2", "標籤3"]
}

只回傳 JSON，不要其他文字。`,
                },
                {
                    role: 'user',
                    content: `文章標題：${title}\n\n文章內容：\n${content.substring(0, 8000)}`,
                },
            ], { maxTokens: 512, temperature: 0.3 });

            let parsed: { summary?: string; tags?: string[] } | undefined;
            try {
                parsed = JSON.parse(metaResult) as { summary?: string; tags?: string[] };
            } catch {
                const match = /(\{[\s\S]*\})/.exec(metaResult);
                if (match) {
                    try { parsed = JSON.parse(match[1]) as { summary?: string; tags?: string[] }; } catch { /* fallback */ }
                }
            }

            if (parsed) {
                summary = parsed.summary ?? '';
                tags = parsed.tags ?? [];
            }
        } catch (err) {
            console.error('AI 摘要生成失敗，使用備用摘要:', err);
        }

        // 備用：若 AI 生成失敗，使用內容截取
        if (!summary) {
            summary = content.replace(/[#*>`\n]/g, ' ').trim().slice(0, 150) + '...';
        }

        // 將資料編碼後跳轉到編輯器
        const articleData = {
            title,
            content,
            tags,
            category: '',
            summary,
            status: 'draft',
        };

        // 不自己 encodeURIComponent：TanStack 的 search 序列化會編碼一次，
        // PostEditor 用 URLSearchParams.get() 解一次。這裡再編一次就會雙重編碼。
        void navigate({
            to: '/admin/posts/create',
            search: { n8n_data: JSON.stringify(articleData) },
        });
        toast.success('已匯入文章編輯器（含 AI 摘要與標籤）');
    };

    // ── 重來 ──
    const handleReset = () => {
        setGeneratedContent('');
        setConversationText('');
        setGuide('');
        setLogs([]);
    };

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-medium text-foreground/90">AI 寫作助手</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        使用 AI 輔助你的寫作流程
                    </p>
                </div>
                {generatedContent && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground/80"
                    >
                        <RotateCcw className="size-3.5" />
                        重來
                    </Button>
                )}
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
                {/* Left - Input area */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Config row */}
                    <div className="flex items-center gap-3">
                        <Select value={articleType} onValueChange={setArticleType}>
                            <SelectTrigger className="w-40 bg-accent/20 border-border/40 text-foreground/70 text-xs h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border/50">
                                {Object.entries(ARTICLE_TYPES).map(([key, type]) => (
                                    <SelectItem key={key} value={key}>
                                        <span className="flex items-center gap-2">
                                            <span>{type.emoji}</span>
                                            <span>{type.label}</span>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            placeholder="導演指令（選填）— 指定主題方向、語氣、禁忌詞等"
                            value={guide}
                            onChange={(e) => setGuide(e.target.value)}
                            className="bg-accent/20 border-border/40 text-foreground/70 text-xs h-8 flex-1 placeholder:text-muted-foreground/40"
                        />
                    </div>

                    {/* Material input */}
                    <div className="glass rounded-xl overflow-hidden">
                        <textarea
                            ref={textareaRef}
                            value={conversationText}
                            onChange={(e) => setConversationText(e.target.value)}
                            placeholder="在這裡貼上你與 AI 的對話、筆記、或任何原始素材..."
                            rows={10}
                            className="w-full bg-transparent text-foreground/80 text-sm leading-relaxed p-4 resize-none outline-hidden placeholder:text-muted-foreground/40 font-mono"
                        />
                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/20">
                            <span className="text-[11px] text-muted-foreground/40">
                                {conversationText.length.toLocaleString()} 字
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs gap-1.5 h-7 px-3 border-border/50 text-foreground/70 hover:bg-accent/40"
                                onClick={() => { void handleGenerate(); }}
                                disabled={isGenerating || !conversationText.trim()}
                            >
                                {isGenerating ? (
                                    <>
                                        <RotateCw className="size-3.5 animate-spin" />
                                        {progressText || '生成中...'}
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="size-3.5" />
                                        生成文章
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Generated output */}
                    {(generatedContent || isGenerating) && (
                        <div className="glass rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/20">
                                <span className="text-[12px] text-muted-foreground/60 flex items-center gap-1.5">
                                    <Sparkles className="size-3" />
                                    AI 生成結果
                                </span>
                                {generatedContent && (
                                    <div className="flex items-center gap-1">
                                        <div className="flex items-center rounded-lg border border-border/40 p-0.5 mr-1">
                                            <button
                                                onClick={() => setViewMode('preview')}
                                                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${viewMode === 'preview' ? 'bg-accent/60 text-foreground/80' : 'text-muted-foreground/50'}`}
                                            >
                                                預覽
                                            </button>
                                            <button
                                                onClick={() => setViewMode('source')}
                                                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${viewMode === 'source' ? 'bg-accent/60 text-foreground/80' : 'text-muted-foreground/50'}`}
                                            >
                                                Markdown
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => { void handleCopy(); }}
                                            className="size-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/40 transition-colors"
                                        >
                                            {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
                                        </button>
                                        <button
                                            onClick={() => { void handleSendToEditor(); }}
                                            className="size-7 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground/60 hover:bg-accent/40 transition-colors"
                                        >
                                            <FileText className="size-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="p-4">
                                {isGenerating ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                                        <div className="relative">
                                            <div className="size-10 rounded-full border-2 border-foreground/10 border-t-foreground/40 animate-spin" />
                                            <Sparkles className="size-4 text-foreground/40 absolute inset-0 m-auto" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[13px] text-foreground/70">{progressText || '生成中...'}</p>
                                            <p className="text-[11px] text-muted-foreground/40 mt-1">
                                                {selectedType.emoji} {selectedType.label} 模式
                                            </p>
                                        </div>
                                    </div>
                                ) : viewMode === 'preview' ? (
                                    <article className="prose prose-invert prose-sm max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h1:mb-6 prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-4 prose-p:leading-relaxed prose-p:text-muted-foreground prose-a:text-foreground/80 prose-a:underline prose-code:text-foreground/70 prose-pre:bg-background/80 prose-pre:border prose-pre:border-border/50 prose-blockquote:border-l-border prose-blockquote:text-muted-foreground/80">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeRaw]}
                                        >
                                            {generatedContent}
                                        </ReactMarkdown>
                                    </article>
                                ) : (
                                    <pre className="text-sm leading-relaxed font-mono whitespace-pre-wrap text-muted-foreground bg-transparent overflow-auto max-h-[700px]">
                                        {generatedContent}
                                    </pre>
                                )}
                            </div>
                            {generatedContent && (
                                <div className="flex items-center justify-between px-4 py-2 border-t border-border/20">
                                    <span className="text-[11px] text-muted-foreground/40">
                                        約 {generatedContent.replace(/\s/g, '').length} 字
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs gap-1.5 h-7 text-muted-foreground/60 hover:text-foreground/70"
                                        onClick={() => { void handleSendToEditor(); }}
                                    >
                                        <Send className="size-3" />
                                        匯入至文章
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right sidebar */}
                <div className="space-y-4">
                    {/* Quick prompts */}
                    <div className="glass rounded-xl">
                        <div className="px-4 py-3 border-b border-border/20">
                            <h2 className="text-[13px] font-medium text-foreground/80">快速指令</h2>
                        </div>
                        <div className="p-3 space-y-1.5">
                            {['幫我寫一篇文章的開頭', '將文字改寫成更精簡', '生成五個標題選項', '為這篇文章寫一段摘要', '續寫接下來的段落'].map((q) => (
                                <button
                                    key={q}
                                    onClick={() => setGuide(q)}
                                    className="w-full text-left text-[12px] text-muted-foreground/60 hover:text-foreground/70 hover:bg-accent/30 px-3 py-2 rounded-lg transition-colors"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Type descriptions */}
                    <div className="glass rounded-xl">
                        <div className="px-4 py-3 border-b border-border/20">
                            <h2 className="text-[13px] font-medium text-foreground/80">文章類型</h2>
                        </div>
                        <div className="divide-y divide-border/15">
                            {Object.entries(ARTICLE_TYPES).map(([key, type]) => (
                                <button
                                    key={key}
                                    className={`w-full text-left px-4 py-3 transition-colors ${articleType === key ? 'bg-accent/20' : 'hover:bg-accent/15'}`}
                                    onClick={() => setArticleType(key)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">{type.emoji}</span>
                                        <span className="text-[12px] text-foreground/70">{type.label}</span>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground/40 mt-0.5">{type.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Debug Logs */}
                    {logs.length > 0 && (
                        <div className="glass rounded-xl">
                            <div className="px-4 py-3 border-b border-border/20">
                                <h2 className="text-[13px] font-medium text-foreground/80">生成日誌</h2>
                            </div>
                            <div className="p-3 max-h-48 overflow-y-auto">
                                {logs.map((log, i) => (
                                    // log 只會往後追加、不會重排或插入，index 即穩定身分
                                    // eslint-disable-next-line @eslint-react/no-array-index-key
                                    <div key={i} className="text-[10px] text-muted-foreground/40 font-mono py-0.5">{log}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
