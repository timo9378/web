// vitest 的全域 setup。**只補環境的缺口，不改變任何被測程式的行為。**
//
// ⚠ 為什麼需要：vitest 的 jsdom 環境沒有把 `localStorage` / `sessionStorage` 接出來
// （實測 vitest 5 + jsdom 29：`window` 是 object、`location.href` 是
//  http://localhost:3000/，但 `window.localStorage` 是 undefined；同一版的原生 jsdom
//  直接 `new JSDOM('', { url })` 則有）。
//
// 後果是任何在 effect 裡讀 localStorage 的元件——`AuthContext`、`Comments`、
// 閱讀字體偏好——一掛就是 `Cannot read properties of undefined (reading 'getItem')`，
// 而那看起來像元件的 bug，其實是測試環境缺東西。
//
// 這裡刻意用**最小的實作**而不是引一個 mock 套件：行為就是一個 Map，
// 跟瀏覽器的差異（配額、跨分頁事件）在單元測試裡都碰不到。
// 每個測試檔是獨立的 worker，所以不必手動清空。

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

if (typeof window !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (!window[name]) {
      Object.defineProperty(window, name, { value: createStorage(), configurable: true, writable: true });
    }
    // 有些程式碼是裸寫 `localStorage.x`（不經過 window），那走的是 globalThis
    if (!(name in globalThis) || !globalThis[name]) {
      Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
    }
  }

  // jsdom 沒有實作，而站上有元件會用到（IntersectionObserver 在 react-intersection-observer
  // 底下、matchMedia 在 prefers-reduced-motion 與 RWD 判斷）。回傳「什麼都不做」的最小實作：
  // 元件掛得起來，而依賴它們的**行為**本來就該由 e2e 驗。
  if (!globalThis.matchMedia) {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!globalThis.IntersectionObserver) {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds: readonly number[] = [];
      },
    });
  }
  if (!globalThis.ResizeObserver) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
}
