// 捲動位置是「外部來源」：值在 render/SSR 期讀不到，只能訂閱。
// 用 useSyncExternalStore 而非 useState + effect，client 首次 render 就拿得到真值，
// 不必靠「effect 裡先呼叫一次 handler」補一次額外 render。
//
// subscribe 必須是模組層級的穩定參考：每次 render 換一個新函式會讓 React 重新訂閱。
export const subscribeScroll = (cb: () => void) => {
  window.addEventListener('scroll', cb, { passive: true });
  return () => { window.removeEventListener('scroll', cb); };
};

/** 已捲動比例 0–1。文件不長於視窗時回 0。 */
export const scrollRatio = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(window.pageYOffset / max, 1) : 0;
};
