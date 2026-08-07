// Shiki 單例 highlighter — fine-grained core：只打包白名單語言的 grammar。
// 之前用完整 bundle（import 'shiki'），rollup 會把全部 ~200 個 grammar 各自切成 chunk
// （emacs-lisp 764K、wolfram 260K…），dist 被撐到 40MB+。改用 shiki/core +
// 顯式語言載入表後，只 emit 下面 LANG_LOADERS 列的語言。

import type { HighlighterCore, LanguageRegistration } from 'shiki/core';
import { lookup } from '@/lib/tableLookup';

interface LangModule { default: LanguageRegistration[] }

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>(['text']);

const THEME = 'vitesse-dark';
const FALLBACK_LANG = 'text';

// 常見語言的 alias → Shiki 內建 id
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'objective-c': 'objc',
  dockerfile: 'docker',
  makefile: 'make',
  // 非合法 shiki id → 最接近的 grammar（舊版會直接 fallback 成純文字）
  svg: 'xml',
  mysql: 'sql',
  postgresql: 'sql',
  plsql: 'sql',
};

// 白名單語言 → 顯式動態 import（bundler 只會打包這些 grammar）
const LANG_LOADERS: Record<string, () => Promise<LangModule>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  jsx: () => import('@shikijs/langs/jsx'),
  tsx: () => import('@shikijs/langs/tsx'),
  json: () => import('@shikijs/langs/json'),
  json5: () => import('@shikijs/langs/json5'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  html: () => import('@shikijs/langs/html'),
  xml: () => import('@shikijs/langs/xml'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  sass: () => import('@shikijs/langs/sass'),
  less: () => import('@shikijs/langs/less'),
  stylus: () => import('@shikijs/langs/stylus'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  scala: () => import('@shikijs/langs/scala'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  objc: () => import('@shikijs/langs/objc'),
  php: () => import('@shikijs/langs/php'),
  lua: () => import('@shikijs/langs/lua'),
  dart: () => import('@shikijs/langs/dart'),
  haskell: () => import('@shikijs/langs/haskell'),
  elixir: () => import('@shikijs/langs/elixir'),
  erlang: () => import('@shikijs/langs/erlang'),
  bash: () => import('@shikijs/langs/bash'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  powershell: () => import('@shikijs/langs/powershell'),
  fish: () => import('@shikijs/langs/fish'),
  docker: () => import('@shikijs/langs/docker'),
  make: () => import('@shikijs/langs/make'),
  cmake: () => import('@shikijs/langs/cmake'),
  sql: () => import('@shikijs/langs/sql'),
  graphql: () => import('@shikijs/langs/graphql'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  tex: () => import('@shikijs/langs/tex'),
  latex: () => import('@shikijs/langs/latex'),
  diff: () => import('@shikijs/langs/diff'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  astro: () => import('@shikijs/langs/astro'),
  'angular-html': () => import('@shikijs/langs/angular-html'),
  regex: () => import('@shikijs/langs/regexp'),
  log: () => import('@shikijs/langs/log'),
};

function resolveLang(input: string | undefined): string {
  if (!input) return FALLBACK_LANG;
  const lower = String(input).toLowerCase();
  const resolved = LANG_ALIAS[lower] || lower;
  return lookup(LANG_LOADERS, resolved) ? resolved : FALLBACK_LANG;
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/oniguruma'),
    ]);
    const h = await createHighlighterCore({
      themes: [import('@shikijs/themes/vitesse-dark')],
      // ⚠ 不預載任何語言。原本這裡是 `[javascript, typescript, tsx]`（註解寫「預載常用」），
      // 而那三個 grammar 加起來 **520 KB**，每一篇文章頁無條件下載。
      //
      // 實測正式站的 18 篇含程式碼文章：真的用到 js/ts/tsx 的只有 8 篇，
      // **10 篇（56%）完全用不到卻照樣付那 520 KB**。而實際最常用的是
      // mermaid(15) / bash(9) / yaml(6) / console(6)，`ts` 只排第六——
      // 那份預載清單是憑印象挑的，跟真實內容對不上。
      //
      // 改成按需載入之後，用到 TS 的頁面會多一次 round trip（grammar 在 init 之後才抓，
      // 不再與 init 平行）。但那正是 bash / yaml / python 這些語言**今天已經在走**的路徑，
      // 也就是 56% 的頁面早就是這個行為，不是新的降級。
      langs: [],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
    return h;
  })();
  return highlighterPromise;
}

export async function highlightCode(code: string, langInput?: string): Promise<string> {
  const lang = resolveLang(langInput);
  const h = await getHighlighter();
  if (lang !== 'text' && !loadedLangs.has(lang)) {
    try {
      await h.loadLanguage(await LANG_LOADERS[lang]());
      loadedLangs.add(lang);
    } catch {
      // 載入失敗就 fallback
      return h.codeToHtml(code, { lang: 'text', theme: THEME });
    }
  }
  return h.codeToHtml(code, { lang: lang === 'text' ? 'text' : lang, theme: THEME });
}
