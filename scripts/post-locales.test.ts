// 連結巡檢挑語系的邏輯。
//
// 為什麼只測這一小段：這支腳本的其餘部分是 I/O（打正式站抓文章、探測外部連結），
// 那些在單元測試裡只能 mock 掉，mock 完剩下的就是 fetch 有沒有被呼叫——沒有價值。
// 而 `localesOf` 是純函式，**而且它是一次真實事故的修正**：
//
// 舊寫法對每篇文章都把 5 個語系全撞一輪，沒有翻譯的回 404。CI 兩次執行
// （2026-08-07 的 08:37 與 09:17，不同的 runner IP）都在恰好 14 個 404、集中在
// 約 11 秒內之後被切斷——最後一個 404 過 6~7 秒，該 IP 的封包開始被丟掉，
// 後續請求全部逾時。那是 CrowdSec http-probing 的特徵（它就是在數 404）。
//
// 這種回歸是安靜的：改壞了不會有人立刻發現，要等排程 job 過幾天變紅，
// 而錯誤訊息只會說「逾時」。所以值得釘住。
import { describe, expect, it } from 'vitest';

import { hostHasNoDot } from './check-links';
import { localesOf, type PostWithLocales } from './post-locales';

const post = (available_locales?: string[]): PostWithLocales => ({
  id: 1,
  ...(available_locales ? { available_locales } : {}),
});

describe('localesOf', () => {
  // 這是關鍵那條：全語系齊全時才該回全部。
  it('五個語系都有 → 五個都抓', () => {
    expect(localesOf(post(['zh-TW', 'zh-CN', 'en', 'ja', 'ko']))).toEqual(['', 'zh-CN', 'en', 'ja', 'ko']);
  });

  // ⚠ 這條就是那 14 個 404 的來源。只有原文的文章佔多數，
  // 舊寫法會替每一篇多打 4 次註定 404 的請求。
  it('只有原文 → 只抓原文，不去撞不存在的語系（那些 404 會讓整支被封鎖）', () => {
    expect(localesOf(post(['zh-TW']))).toEqual(['']);
  });

  it('部分語系 → 只抓有的那些', () => {
    expect(localesOf(post(['zh-TW', 'en']))).toEqual(['', 'en']);
    expect(localesOf(post(['zh-TW', 'ja', 'ko']))).toEqual(['', 'ja', 'ko']);
  });

  // 原文用空字串表示（對應不帶 ?lang= 的網址），而 available_locales 用 'zh-TW'。
  // 兩邊的表示法不同，這是最容易寫錯的地方：拿 '' 去 has.has('') 會永遠落空，
  // 結果就是每篇都少抓原文——而原文正是唯一保證存在的那一個。
  it('原文永遠留著，即使 available_locales 沒有列出 zh-TW', () => {
    expect(localesOf(post(['en', 'ja']))).toContain('');
    expect(localesOf(post(['en']))).toEqual(['', 'en']);
  });

  // 舊資料 / 舊版後端可能沒有這一欄。此時退回全語系維持原行為：
  // 少抓會讓連結漏檢，而漏檢是這支腳本存在的反面。
  it('沒有 available_locales 欄位 → 退回全語系（寧可多抓也不要漏檢）', () => {
    expect(localesOf(post())).toEqual(['', 'zh-CN', 'en', 'ja', 'ko']);
  });

  it('available_locales 是空陣列 → 同樣退回全語系（空陣列不可能是真的）', () => {
    expect(localesOf(post([]))).toEqual(['', 'zh-CN', 'en', 'ja', 'ko']);
  });

  // 認不得的語系不該讓它多打一次請求
  it('出現沒在支援清單裡的語系 → 忽略，不會多抓', () => {
    expect(localesOf(post(['zh-TW', 'de', 'fr']))).toEqual(['']);
  });

  it('回傳順序固定跟著 LOCALES，不隨 available_locales 的順序變', () => {
    expect(localesOf(post(['ko', 'en', 'zh-TW', 'ja', 'zh-CN']))).toEqual(['', 'zh-CN', 'en', 'ja', 'ko']);
  });
});

describe('hostHasNoDot', () => {
  // 這條的由來：實地跑出來的 9 個「連不上的外部連結」裡有 5 個是同一句教學文的
  // 五語系版本（`http://你的網域/…`、`你的网域`、`your-domain`、`あなたのドメイン`、
  // `당신의도메인`）。訊噪比一旦掉下來就沒有人會再看這支腳本的輸出。
  it('五語系的「你的網域」佔位符全部濾掉', () => {
    for (const h of ['你的網域', '你的网域', 'your-domain', 'あなたのドメイン', '당신의도메인']) {
      expect(hostHasNoDot(`http://${h}/.well-known/acme-challenge/`), h).toBe(true);
    }
  });

  // 反面才是重點：濾太寬等於連結從此不再被檢查，而那是這支腳本存在的反面。
  it('真的網域一律留著（含子網域、通訊埠、IP、非 ASCII 網域）', () => {
    for (const u of [
      'https://koimsurai.com/blog/1',
      'https://registry.npmjs.org/anigamer',
      'https://sub.domain.example.co.uk/a?b=c#d',
      'https://example.com:8443/x',
      'https://1.1.1.1/',
      'https://例え.jp/',
    ]) {
      expect(hostHasNoDot(u), u).toBe(false);
    }
  });

  it('parse 不了的字串不在這裡吞掉，交給後面的探測去報', () => {
    expect(hostHasNoDot('not a url')).toBe(false);
    expect(hostHasNoDot('')).toBe(false);
  });
});
