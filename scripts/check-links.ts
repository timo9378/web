/**
 * 已發布文章裡的連結巡檢。
 *
 * ## 為什麼要有
 *
 * 連結會在沒有人動任何程式碼的情況下爛掉——對方改網址、關站、或是我們自己把某個頁面
 * 拿掉了。這種事沒有任何症狀，讀者點到 404 也不會回報。實測第一次跑就抓到
 * `https://koimsurai.com/now`：那是 2026-02 的文章提到的自家頁面，後來站台改版時消失了。
 *
 * ## 兩件讓它不變成噪音的事
 *
 * 1. **先去掉程式碼區塊**（`strip-code.ts`）。第一次量的時候 8 個「壞連結」裡有 6 個
 *    是程式碼範例裡的佔位符——`{animeSn}`、`$DOMAIN`、`minio:9000`、`*.gamer.com.tw`。
 *    不濾掉的話這支腳本的訊噪比是 2:6。
 *
 * 2. **內部連結才擋 CI，外部只回報**。外部網站掛掉不是我們的 bug，讓排程 job 因為
 *    github.com 抽風而變紅，只會訓練大家忽略它。自家網址回 404 則百分之百是我們的問題。
 *
 * 3. **會擋 bot 的站改打它的官方 API**（見 `API_REWRITE`），而不是把它們加進
 *    「已知誤報就略過」的白名單。略過等於那個連結從此不再被檢查——套件被下架、
 *    網址打錯字都不會有人知道。改寫成 API 之後這些情況照樣抓得到。
 *
 * 用法：
 *   pnpm check:links
 *   SITE_URL=http://127.0.0.1:3002 pnpm check:links
 */

import { stripCode } from './strip-code';

const SITE = (process.env.SITE_URL ?? 'https://koimsurai.com').replace(/\/$/, '');
const SITE_HOST = new URL(SITE).hostname;
const LOCALES = ['', 'zh-CN', 'en', 'ja', 'ko'] as const;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/**
 * 有些站的**網頁**對非瀏覽器客戶端不給正常回應，但它們都有不擋 bot 的官方 API。
 * 這裡把網址改寫成 API 版本去問——**不是跳過檢查**。
 *
 * 為什麼不用「已知誤報就略過」的白名單：那樣一來，套件哪天真的被下架、
 * 或是連結打錯字，就再也不會有人知道。改寫成 API 之後那些情況照樣抓得到。
 *
 * 兩個都實測過：
 *   crates.io  網頁連打 3 次都是 404，而 index/API 是 200（anigamer 0.1.0 確實存在）
 *   npm        網頁單獨打是 200，但整批跑到它時穩定 403；退避 4s／12s 都清不掉
 *              ——邊緣一旦判定是自動流量就封一段時間。registry API 不受影響。
 */
const API_REWRITE: { re: RegExp; to: (m: RegExpMatchArray) => string }[] = [
  {
    re: /^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/,
    to: (m) => `https://registry.npmjs.org/${m[1]}`,
  },
  {
    re: /^https?:\/\/crates\.io\/crates\/([^/?#]+)/,
    to: (m) => `https://crates.io/api/v1/crates/${m[1]}`,
  },
];

/** 網址若有 API 版本就換掉；沒有就原樣回傳。 */
function resolveProbeUrl(url: string): { probe: string; rewritten: boolean } {
  for (const { re, to } of API_REWRITE) {
    const m = re.exec(url);
    if (m) return { probe: to(m), rewritten: true };
  }
  return { probe: url, rewritten: false };
}

/** 程式碼以外也可能出現的佔位符：有這些字元就不是真的網址。 */
const PLACEHOLDER = /[{}$*<>]|\.\.\.|xxx|檔名/i;
/** 容器內部 / 本機位址，文章裡是設定範例不是連結。 */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|[a-z0-9-]+:\d{2,5}\/?$)/i;

interface PostListItem {
  id: number;
  title: string;
  slug: string | null;
}
interface PostDetail {
  id: number;
  title: string;
  slug: string | null;
  content: string | null;
}

interface Finding {
  url: string;
  status: number | string;
  posts: string[];
  internal: boolean;
}

/**
 * 「這次擋你、不代表連結壞了」的回應碼。
 *
 * 實際踩到：一批 6 個併發打下去，npm 回 403；隔一秒單獨再打同一個網址是 200，
 * 連打三次都是 200。也就是那個 403 是**節流**不是壞連結。把它當成壞連結報出來，
 * 這支腳本就會變成「每次都有一兩個假警報」的東西，然後沒有人會再看它。
 */
const TRANSIENT = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
/** 退避時間。短退避（1.5s）實測不夠——整批跑完 IP 已經被記帳，要等久一點才放行。 */
const BACKOFF_MS = [4_000, 12_000];

/** HEAD 先試（省流量），不吃 HEAD 的站再用 GET；遇到疑似節流就退避重試一次。 */
async function probe(url: string, attempt = 0): Promise<number | string> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const r = await fetch(url, {
        method,
        headers: { 'user-agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return r.status;
      // 405 = 這個站不支援 HEAD，換 GET 再試
      if (method === 'HEAD' && (r.status === 405 || r.status === 501)) continue;
      if (method === 'GET') {
        if (TRANSIENT.has(r.status) && attempt < 2) {
          // 退避後單獨重打——併發是節流的主因，重試時已經不在那一批裡了
          await new Promise((res) => setTimeout(res, BACKOFF_MS[attempt] ?? 10_000));
          return probe(url, attempt + 1);
        }
        return r.status;
      }
    } catch (e) {
      if (method === 'GET') {
        if (attempt < 2) {
          await new Promise((res) => setTimeout(res, BACKOFF_MS[attempt] ?? 10_000));
          return probe(url, attempt + 1);
        }
        return e instanceof Error ? e.name : 'ERR';
      }
    }
  }
  return 'ERR';
}

async function main(): Promise<void> {
  const listRes = await fetch(`${SITE}/api/posts?limit=500`);
  if (!listRes.ok) throw new Error(`取文章清單失敗：${listRes.status}`);
  const { posts } = (await listRes.json()) as { posts: PostListItem[] };

  // url → 出現在哪幾篇（同一個連結被多篇引用時，壞掉要一次列出全部）
  const found = new Map<string, Set<string>>();
  for (const p of posts) {
    for (const lang of LOCALES) {
      const url = lang
        ? `${SITE}/api/posts/${p.id}?lang=${encodeURIComponent(lang)}`
        : `${SITE}/api/posts/${p.id}`;
      const res = await fetch(url);
      if (res.status === 404) continue; // 該語系無此文，正常
      if (!res.ok) continue;
      const post = (await res.json()) as PostDetail;
      if (!post.content) continue;
      const where = post.slug ?? `#${post.id}`;
      for (const m of stripCode(post.content).matchAll(/https?:\/\/[^\s)>\]"'`]+/g)) {
        const link = m[0].replace(/[.,;:！。，]+$/, '');
        if (PLACEHOLDER.test(link) || LOCAL.test(link)) continue;
        const seen = found.get(link) ?? new Set<string>();
        seen.add(where);
        found.set(link, seen);
      }
    }
  }

  const links = [...found.keys()];
  const internalCount = links.filter((u) => new URL(u).hostname === SITE_HOST).length;
  console.log(
    `${SITE} — ${posts.length} 篇已發布，去掉程式碼與佔位符後有 ${links.length} 個連結` +
      `（自家 ${internalCount}、外部 ${links.length - internalCount}）\n`,
  );

  const rewritten = links.filter((u) => resolveProbeUrl(u).rewritten);
  if (rewritten.length) {
    console.log(`${rewritten.length} 個連結改用官方 API 查（網頁會擋 bot，見 API_REWRITE 的註解）：`);
    for (const u of rewritten) console.log(`  ${u}  →  ${resolveProbeUrl(u).probe}`);
    console.log();
  }

  const findings: Finding[] = [];
  // 併發是節流的主因，壓低一點；49 個連結就算序列化也只是幾十秒的事。
  const BATCH = 3;
  for (let i = 0; i < links.length; i += BATCH) {
    const chunk = links.slice(i, i + BATCH);
    const statuses = await Promise.all(chunk.map((u) => probe(resolveProbeUrl(u).probe)));
    chunk.forEach((url, k) => {
      const status = statuses[k];
      const host = new URL(url).hostname;
      if (typeof status === 'number' && status < 400) return;
      findings.push({ url, status, posts: [...(found.get(url) ?? [])], internal: host === SITE_HOST });
    });
  }

  const internal = findings.filter((f) => f.internal);
  const external = findings.filter((f) => !f.internal);

  if (external.length) {
    console.log(`⚠ 外部連結有 ${external.length} 個連不上（不擋 CI——對方掛掉不是我們的 bug）：`);
    for (const f of external) {
      console.log(`  ${String(f.status).padEnd(5)} ${f.url}`);
      console.log(`        出現在：${f.posts.join(', ')}`);
    }
    console.log();
  }

  if (internal.length) {
    console.error(`❌ 自家連結有 ${internal.length} 個是壞的——讀者點下去就是 404：`);
    for (const f of internal) {
      console.error(`  ${String(f.status).padEnd(5)} ${f.url}`);
      console.error(`        出現在：${f.posts.join(', ')}`);
    }
    console.error('\n自家網址回 4xx 一定是我們的問題：頁面被拿掉了，或是文章寫錯網址。');
    process.exit(1);
  }

  console.log(`✅ ${links.length} 個連結，自家的全部正常${external.length ? '（外部的見上方）' : ''}`);
}

main().catch((e: unknown) => {
  console.error('check-links 執行失敗:', e instanceof Error ? e.message : e);
  process.exit(1);
});
