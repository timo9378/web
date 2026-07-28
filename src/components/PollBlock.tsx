/* MDX <Poll>：文章內嵌投票（真投票，票數存後端）。
   - 題目與選項在文章裡寫死 → SSR 就有內容（SEO / 無 JS 也讀得到）。
   - 票數與「我投過沒」在掛載後才載入（localStorage 防重複，與站上 reactions 同策略，不收 IP）。
   - 投過或按「看結果」才顯示長條與百分比，避免投票前先被結果帶風向。 */
import { useCallback, useEffect, useState } from 'react';

interface PollOption { key?: string; label?: string }
interface Props {
  id?: string;
  question?: string;
  options?: PollOption[];
  /** 顯示總票數（預設顯示） */
  showTotal?: boolean;
}

interface Counts { options: { option_key: string; count: number }[]; total: number }

const votedKey = (id: string) => `poll:${id}`;

export default function PollBlock({ id, question, options = [], showTotal = true }: Props) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  // 掛載後才讀 localStorage + 抓票數（SSR 與首次 client render 一致 → 不會 hydration mismatch）。
  // 所有 setState 都在非同步 callback 裡（不在 effect 同步段），避免多餘的即時重繪。
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let prev: string | null = null;
    try { prev = localStorage.getItem(votedKey(id)); } catch { /* 不可用就當沒投過 */ }
    const applyPrev = () => {
      if (cancelled || !prev) return;
      setMyVote(prev);
      setRevealed(true);
    };
    const ac = new AbortController();
    fetch(`/api/polls/${encodeURIComponent(id)}`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
      .then((d) => {
        if (cancelled) return;
        if (d) setCounts(d);
        applyPrev();
      })
      .catch(applyPrev); // 抓票數失敗仍要標出「已投過」，且題目與選項照樣顯示
                         // （中止時 applyPrev 會被 cancelled 擋掉，不會亂動狀態）
    return () => { cancelled = true; ac.abort(); };
  }, [id]);

  const vote = useCallback((optKey: string) => {
    if (!id || myVote || busy) return;
    setBusy(true);
    fetch(`/api/polls/${encodeURIComponent(id)}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option: optKey }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
      .then((d) => {
        if (d) setCounts(d);
        setMyVote(optKey);
        setRevealed(true);
        try { localStorage.setItem(votedKey(id), optKey); } catch { /* 忽略 */ }
      })
      .catch(() => { /* 失敗就維持未投票狀態，讓使用者可再試 */ })
      .finally(() => setBusy(false));
  }, [id, myVote, busy]);

  if (!id || !options.length) return null;
  const total = counts?.total ?? 0;
  const countOf = (k: string) => counts?.options.find((o) => o.option_key === k)?.count ?? 0;

  return (
    <div className="mdx-poll">
      {question ? <div className="mdx-poll-q">{question}</div> : null}
      <ul className="mdx-poll-list">
        {options.map((o, i) => {
          const key = o.key ?? String(i);
          const label = o.label ?? key;
          const n = countOf(key);
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myVote === key;
          return (
            <li key={key}>
              <button
                type="button"
                className={mine ? 'mdx-poll-opt mdx-poll-opt--mine' : 'mdx-poll-opt'}
                onClick={() => vote(key)}
                disabled={!!myVote || busy}
                aria-label={revealed ? `${label}：${n} 票（${pct}%）` : label}
              >
                {revealed && <span className="mdx-poll-bar" style={{ width: `${pct}%` }} aria-hidden />}
                <span className="mdx-poll-opt-label">
                  {mine ? <span className="mdx-poll-check" aria-hidden /> : null}
                  {label}
                </span>
                {revealed && <span className="mdx-poll-pct">{pct}%</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mdx-poll-foot">
        {showTotal ? <span>{total} 票</span> : null}
        {!revealed && (
          <button type="button" className="mdx-poll-peek" onClick={() => setRevealed(true)}>
            先看結果
          </button>
        )}
        {myVote ? <span className="mdx-poll-voted">已投票</span> : null}
      </div>
    </div>
  );
}
