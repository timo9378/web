import { parseServerDate } from '@/lib/serverDate';

// 留言區的純邏輯：送出前的驗證、巢狀分組、頭像配色、相對時間。
//
// 從 Comments.tsx 抽出來的理由跟 blogReading.ts 一樣：這些東西原本埋在元件裡，
// e2e 只走到 21%，而它們的失敗模式全是「安靜地錯」——驗證放行了不該放行的、
// 回覆掛到錯的父留言、時間差八小時。都不會有錯誤訊息。

/** 送出前擋下來的原因。訊息由呼叫端對應 i18n key —— 純函式不碰 i18n。 */
export type CommentDraftError = 'empty' | 'noName' | 'captcha';

export interface CommentDraft {
  content: string;
  author: string;
  /** 使用者填的驗證碼答案（表單來的字串）。 */
  captchaAnswer: string;
  /** 正確答案（num1 + num2）。 */
  captchaSum: number;
  /**
   * 是否需要暱稱與驗證碼。
   * 登入且沒有勾「匿名」時為 false —— 身分由 token 決定，不必再問一次。
   */
  requiresIdentity: boolean;
}

/**
 * 檢查一則留言草稿能不能送出。回 null 代表通過。
 *
 * ⚠ 順序有意義，不要調換：內容為空要**優先**於暱稱與驗證碼。
 * 反過來的話，只按了送出（三個欄位都空）的人會先被念「驗證碼錯誤」，
 * 而他根本還沒開始填。
 */
export function validateCommentDraft(draft: CommentDraft): CommentDraftError | null {
  if (!draft.content.trim()) return 'empty';
  if (!draft.requiresIdentity) return null;
  if (!draft.author.trim()) return 'noName';
  // ⚠ 用 parseInt 而不是 Number：跟原本的行為一致（`"7 "`、`"7x"` 都當 7）。
  //   空字串 parseInt 得到 NaN，而 NaN !== sum 恆成立 → 擋下來，這是對的。
  if (Number.parseInt(draft.captchaAnswer, 10) !== draft.captchaSum) return 'captcha';
  return null;
}

/** 分組後的留言。`roots` 保持原本的先後順序。 */
export interface ThreadedComments<T> {
  roots: T[];
  /** 父留言 id → 它底下的回覆（同樣保持原順序）。 */
  repliesOf: Map<number, T[]>;
}

/**
 * 把扁平的留言陣列分成「根留言」與「各自的回覆」。
 *
 * ⚠ 這個函式順帶修掉一個顯示 bug。原本的渲染是直接 `comments.map((comment, idx) => …)`，
 * 遇到子留言就 `return null` 跳過，而時間軸的連接線判斷寫成
 * `idx < comments.filter(c => !c.parent_id).length - 1`——**`idx` 是整個陣列的索引，
 * 卻拿去跟「根留言的數量」比**。中間夾了回覆之後 idx 會提前超過根留言數，
 * 於是後面那些根留言的連接線會消失。改成先分組、再用「在 roots 裡的索引」判斷就沒有這個問題。
 *
 * 只支援一層：回覆的回覆（parent 指向另一則回覆）在資料層是允許的，但畫面本來就只畫兩層。
 * 這裡照原本的行為，把它們掛在它自己的 parent_id 底下——不會消失，只是不會再往下縮排。
 */
export function groupComments<T extends { id: number; parent_id?: number | null }>(
  comments: readonly T[],
): ThreadedComments<T> {
  const roots: T[] = [];
  const repliesOf = new Map<number, T[]>();
  for (const c of comments) {
    if (c.parent_id == null) {
      roots.push(c);
      continue;
    }
    const list = repliesOf.get(c.parent_id);
    if (list) list.push(c);
    else repliesOf.set(c.parent_id, [c]);
  }
  return { roots, repliesOf };
}

/** 沒有頭像時的底色。同一個名字永遠同一個顏色。 */
const AVATAR_COLORS = ['#7f5af0', '#2cb67d', '#e53170', '#ff8906', '#3da9fc', '#ef4444', '#8b5cf6', '#06b6d4'];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** 相對時間的分類。實際文案由呼叫端對應 i18n key。 */
export type RelativeTime =
  | { kind: 'justNow' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }
  | { kind: 'absolute'; date: Date };

/**
 * 把留言時間分類成「剛剛／N 分鐘前／N 小時前／N 天前／絕對日期」。
 *
 * ⚠ SQLite 的 `CURRENT_TIMESTAMP` 存的是 **UTC**，但字串長得像 `2026-08-05 12:00:00`
 * ——沒有時區標記。JS 的 `new Date()` 遇到這種格式會當成**本地時間**，於是在 UTC+8
 * 的機器上每一則留言都會早八小時，畫面上就是「8 小時前」起跳。所以要補 `Z`。
 * 已經有 `T` 或 `Z` 的（API 回的 ISO 格式）就不動。
 *
 * `now` 由呼叫端傳入而不是在函式裡取——這樣才測得動。
 */
export function relativeTime(dateStr: string, now: Date): RelativeTime {
  const date = parseServerDate(dateStr);
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return { kind: 'justNow' };
  if (mins < 60) return { kind: 'minutes', count: mins };
  if (hrs < 24) return { kind: 'hours', count: hrs };
  if (days < 7) return { kind: 'days', count: days };
  return { kind: 'absolute', date };
}
