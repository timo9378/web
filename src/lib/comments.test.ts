import { describe, expect, it } from 'vitest';
import { avatarColor, groupComments, relativeTime, validateCommentDraft } from './comments';

// 留言區原本 546 statements 只走到 21%——登入後的路徑、驗證的每個分支、
// 巢狀的組法全都沒被驗過。這幾條都是「安靜地錯」的類型：
// 放行了不該放行的、回覆掛到錯的父留言、時間差八小時。

describe('validateCommentDraft', () => {
  const anon = { content: '內容', author: '路人', captchaAnswer: '7', captchaSum: 7, requiresIdentity: true };

  it('匿名模式：內容、暱稱、驗證碼都對就放行', () => {
    expect(validateCommentDraft(anon)).toBeNull();
  });

  it('內容為空一律擋下，連空白也算空', () => {
    expect(validateCommentDraft({ ...anon, content: '' })).toBe('empty');
    expect(validateCommentDraft({ ...anon, content: '   \n  ' })).toBe('empty');
  });

  // 順序有意義：三個欄位都空的時候，要念「還沒寫內容」而不是「驗證碼錯誤」——
  // 後者對一個還沒開始填的人是莫名其妙的訊息。
  it('內容為空的優先權高於暱稱與驗證碼', () => {
    expect(validateCommentDraft({ content: '', author: '', captchaAnswer: '', captchaSum: 7, requiresIdentity: true }))
      .toBe('empty');
  });

  it('匿名模式沒填暱稱擋下', () => {
    expect(validateCommentDraft({ ...anon, author: '' })).toBe('noName');
    expect(validateCommentDraft({ ...anon, author: '  ' })).toBe('noName');
  });

  it('驗證碼錯的擋下', () => {
    expect(validateCommentDraft({ ...anon, captchaAnswer: '8' })).toBe('captcha');
    expect(validateCommentDraft({ ...anon, captchaAnswer: '' })).toBe('captcha');
    expect(validateCommentDraft({ ...anon, captchaAnswer: 'abc' })).toBe('captcha');
  });

  it('驗證碼用 parseInt 解析，後綴不影響（維持原本行為）', () => {
    expect(validateCommentDraft({ ...anon, captchaAnswer: '7 ' })).toBeNull();
    expect(validateCommentDraft({ ...anon, captchaAnswer: '7x' })).toBeNull();
  });

  // 這是登入使用者的路徑，e2e 完全沒走到過
  it('登入模式不問暱稱與驗證碼', () => {
    expect(
      validateCommentDraft({ content: '內容', author: '', captchaAnswer: '', captchaSum: 7, requiresIdentity: false }),
    ).toBeNull();
  });

  it('登入模式仍然擋空內容', () => {
    expect(
      validateCommentDraft({ content: '  ', author: '', captchaAnswer: '', captchaSum: 7, requiresIdentity: false }),
    ).toBe('empty');
  });
});

describe('groupComments', () => {
  const c = (id: number, parent_id: number | null = null) => ({ id, parent_id });

  it('沒有回覆時全部都是根留言', () => {
    const { roots, repliesOf } = groupComments([c(1), c(2), c(3)]);
    expect(roots.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(repliesOf.size).toBe(0);
  });

  it('回覆掛到正確的父留言底下', () => {
    const { roots, repliesOf } = groupComments([c(1), c(2, 1), c(3), c(4, 1), c(5, 3)]);
    expect(roots.map((x) => x.id)).toEqual([1, 3]);
    expect(repliesOf.get(1)?.map((x) => x.id)).toEqual([2, 4]);
    expect(repliesOf.get(3)?.map((x) => x.id)).toEqual([5]);
  });

  it('根留言與回覆都保持原本的先後順序', () => {
    const { roots, repliesOf } = groupComments([c(10), c(30, 10), c(20), c(20, 10)]);
    expect(roots.map((x) => x.id)).toEqual([10, 20]);
    expect(repliesOf.get(10)?.map((x) => x.id)).toEqual([30, 20]);
  });

  // 這一組就是原本那個顯示 bug 的形狀：回覆夾在中間，導致「整個陣列的 idx」
  // 提前超過根留言數，後面那些根留言的時間軸連接線就消失了。
  it('回覆夾在中間時，根留言的相對位置仍然正確', () => {
    const { roots } = groupComments([c(1), c(2, 1), c(3, 1), c(4), c(5)]);
    expect(roots.map((x) => x.id)).toEqual([1, 4, 5]);
    // 舊實作用 comments 的 idx（4 號在陣列裡是 index 3）去跟 roots.length-1（2）比 →
    // 3 < 2 為 false → 少畫一條線。用 roots 的 idx（1）就對了。
    expect(roots.findIndex((x) => x.id === 4)).toBe(1);
  });

  it('parent_id 是 undefined 或 null 都算根留言', () => {
    const { roots } = groupComments([{ id: 1 }, { id: 2, parent_id: null }, { id: 3, parent_id: undefined }]);
    expect(roots.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('父留言不在清單裡的孤兒回覆不會變成根留言', () => {
    const { roots, repliesOf } = groupComments([c(1), c(9, 999)]);
    expect(roots.map((x) => x.id)).toEqual([1]);
    expect(repliesOf.get(999)?.map((x) => x.id)).toEqual([9]);
  });

  it('空陣列不會炸', () => {
    expect(groupComments([])).toEqual({ roots: [], repliesOf: new Map() });
  });
});

describe('avatarColor', () => {
  it('同一個名字永遠同一個顏色', () => {
    expect(avatarColor('路過的讀者')).toBe(avatarColor('路過的讀者'));
  });

  it('回傳的一定是色票裡的其中一個', () => {
    const palette = ['#7f5af0', '#2cb67d', '#e53170', '#ff8906', '#3da9fc', '#ef4444', '#8b5cf6', '#06b6d4'];
    for (const name of ['a', '路人', 'Koimsurai', '🎉', '', 'zzzzzzzzzzzz']) {
      expect(palette, `${name} 算出界了`).toContain(avatarColor(name));
    }
  });

  it('空字串也有顏色，不會是 undefined', () => {
    expect(avatarColor('')).toBeTruthy();
  });

  it('不同名字大致會分散到不同顏色（不是全部撞同一色）', () => {
    const names = Array.from({ length: 30 }, (_, i) => `使用者${i}`);
    expect(new Set(names.map(avatarColor)).size).toBeGreaterThan(3);
  });
});

describe('relativeTime', () => {
  const NOW = new Date('2026-08-05T12:00:00Z');

  it('一分鐘內是「剛剛」', () => {
    expect(relativeTime('2026-08-05T11:59:30Z', NOW)).toEqual({ kind: 'justNow' });
  });

  it('依序落到分鐘、小時、天', () => {
    expect(relativeTime('2026-08-05T11:30:00Z', NOW)).toEqual({ kind: 'minutes', count: 30 });
    expect(relativeTime('2026-08-05T09:00:00Z', NOW)).toEqual({ kind: 'hours', count: 3 });
    expect(relativeTime('2026-08-03T12:00:00Z', NOW)).toEqual({ kind: 'days', count: 2 });
  });

  it('超過七天改用絕對日期', () => {
    const r = relativeTime('2026-07-01T12:00:00Z', NOW);
    expect(r.kind).toBe('absolute');
  });

  it('邊界：59 分鐘還是分鐘、60 分鐘變小時；6 天還是天、7 天變絕對', () => {
    expect(relativeTime('2026-08-05T11:01:00Z', NOW).kind).toBe('minutes');
    expect(relativeTime('2026-08-05T11:00:00Z', NOW).kind).toBe('hours');
    expect(relativeTime('2026-07-30T12:00:00Z', NOW).kind).toBe('days');
    expect(relativeTime('2026-07-29T12:00:00Z', NOW).kind).toBe('absolute');
  });

  // 這條是重點：SQLite 的 CURRENT_TIMESTAMP 存 UTC，但字串沒有時區標記。
  // 不補 `Z` 的話 JS 會當成本地時間，在 UTC+8 的機器上每則留言都早八小時，
  // 畫面上就是所有留言都「8 小時前」起跳——而且不會有任何錯誤。
  it('SQLite 的無時區字串當成 UTC 解析', () => {
    expect(relativeTime('2026-08-05 11:30:00', NOW)).toEqual({ kind: 'minutes', count: 30 });
  });

  it('已經有時區標記的不會被重複加工', () => {
    expect(relativeTime('2026-08-05T11:30:00Z', NOW)).toEqual({ kind: 'minutes', count: 30 });
    expect(relativeTime('2026-08-05T19:30:00+08:00', NOW)).toEqual({ kind: 'minutes', count: 30 });
  });

  it('未來時間（時鐘有偏差）當成剛剛，不會變成負數', () => {
    expect(relativeTime('2026-08-05T12:05:00Z', NOW)).toEqual({ kind: 'justNow' });
  });
});
