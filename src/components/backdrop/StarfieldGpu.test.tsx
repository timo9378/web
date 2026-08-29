// @vitest-environment jsdom
//
// StarfieldGpu 的「壞掉之後怎麼辦」。
//
// 為什麼是這幾條：這支元件的正常路徑（星星轉、土星轉）在 jsdom 裡驗不了，也不該在這裡驗——
// 那是 GPU 的事。但它的**失效處理**是純粹的狀態機，而站上真的出過事：
// GPU device lost 之後 renderer 一幀都不會再畫，而專案原本完全沒接這個回呼，
// 使用者看到的是「星空停住、切回首頁連土星都不出現，只有重整能救」（流星是 CSS 特效所以還在跑）。
//
// 這裡蓋三件事：掉了會不會重建、重建幾次之後會不會放棄、以及分頁在背景時會不會白重建一次。
// 外加一條「掛載當下就同步一次狀態」——lazy 元件掛好之前發生的全螢幕，事件早就發完了。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

function makeRunner() {
  return {
    setSize: vi.fn(),
    setScroll: vi.fn(),
    setSaturn: vi.fn(),
    setRunning: vi.fn(),
    dispose: vi.fn(),
  };
}

/** 每次 createStarfieldRunner 都給一個新的 runner，這樣「重建了沒」看得出來 */
const runners: ReturnType<typeof makeRunner>[] = [];
const lostHandlers: ((message: string) => void)[] = [];

vi.mock('@/lib/starfieldGpu', () => ({
  createStarfieldRunner: vi.fn((init: { onDeviceLost?: (m: string) => void }) => {
    const r = makeRunner();
    runners.push(r);
    if (init.onDeviceLost) lostHandlers.push(init.onDeviceLost);
    return Promise.resolve({ runner: r, backend: 'WebGL2' });
  }),
}));

const canvases = () => [...document.querySelectorAll('canvas')];

/**
 * 讓 document 看起來像在全螢幕。
 *
 * 不能用 vi.spyOn：jsdom 沒有實作 Fullscreen API，`fullscreenElement` 這個屬性
 * 根本不存在，spyOn 會直接報 "The property is not defined on the object"。
 */
function enterFullscreen() {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => document.body,
  });
}

beforeEach(() => {
  runners.length = 0;
  lostHandlers.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
});

/** 觸發 device lost 並把 recover 的 500ms 延遲跑掉 */
async function loseDevice(message = '測試用 device lost') {
  await act(async () => {
    lostHandlers.at(-1)?.(message);
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe('主執行緒路徑的 device lost 重建', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  async function mount() {
    const { default: StarfieldGpu } = await import('./StarfieldGpu');
    const view = render(<StarfieldGpu />);
    // 動態 import + createStarfieldRunner 的 promise
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  }

  it('device lost 之後換一張新的 canvas 並重建 runner', async () => {
    await mount();
    expect(runners).toHaveLength(1);
    const before = canvases()[0];

    await loseDevice();

    expect(runners).toHaveLength(2);
    // ⚠ 必須是**不同的 DOM 節點**：transferControlToOffscreen 一張 canvas 只能做一次，
    // 沿用同一個節點的話 worker 路徑重建會直接失敗。
    expect(canvases()[0]).not.toBe(before);
    // 舊的要收掉，否則每重建一次就漏一個 WebGL context（瀏覽器有上限）
    expect(runners[0].dispose).toHaveBeenCalled();
  });

  it('重建 3 次仍然掉 → 收掉 3D，不會無限重建', async () => {
    await mount();
    for (let i = 0; i < 3; i++) await loseDevice();
    expect(runners).toHaveLength(4); // 初始 1 + 重建 3
    expect(canvases()).toHaveLength(1);

    await loseDevice(); // 第 4 次：放棄

    expect(runners).toHaveLength(4); // 沒有再建
    expect(canvases()).toHaveLength(0); // 元件回傳 null，由 DOM 特效兜底
  });

  // 分頁在背景時 GPU 資源正是被回收的當下，這時重建八成又立刻掉一次——
  // 白白吃掉一次重建額度。等切回來再做。
  it('分頁在背景時不重建，切回來才重建', async () => {
    await mount();
    const before = canvases()[0];
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await loseDevice();
    expect(runners).toHaveLength(1); // 還沒重建
    expect(canvases()[0]).toBe(before);

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(runners).toHaveLength(2);
    expect(canvases()[0]).not.toBe(before);
  });
});

describe('掛載當下就同步一次執行狀態', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('主執行緒路徑：全螢幕中掛載 → runner 一建好就被停下來', async () => {
    // 這條守的是「事件只反應變化」的坑：這支元件是 lazy 的（intro 播完 + three chunk
    // 下載完才掛），在它掛好之前進的全螢幕，fullscreenchange 早就發完了，
    // 監聽器一個字都收不到，於是背景用預設值跑起來、整場全螢幕都在跟影片搶 GPU。
    enterFullscreen();
    const { default: StarfieldGpu } = await import('./StarfieldGpu');
    render(<StarfieldGpu />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(runners[0].setRunning).toHaveBeenCalledWith(false);
  });
});

describe('worker 路徑（正式環境的預設）', () => {
  const workers: FakeWorker[] = [];

  class FakeWorker {
    posted: { type: string; value?: boolean }[] = [];
    terminated = false;
    listeners: ((e: { data: unknown }) => void)[] = [];
    constructor() {
      workers.push(this);
    }
    postMessage(m: { type: string; value?: boolean }) {
      this.posted.push(m);
    }
    addEventListener(t: string, fn: (e: { data: unknown }) => void) {
      if (t === 'message') this.listeners.push(fn);
    }
    removeEventListener() {
      /* 測試不需要 */
    }
    terminate() {
      this.terminated = true;
    }
    emit(data: unknown) {
      for (const fn of this.listeners) fn({ data });
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    workers.length = 0;
    // canOffscreen 是模組載入時算的 → 必須在 import 之前備好
    HTMLCanvasElement.prototype.transferControlToOffscreen = vi.fn(() => ({}) as OffscreenCanvas);
    vi.stubGlobal('Worker', FakeWorker);
    vi.resetModules();
  });

  afterEach(() => {
    delete (HTMLCanvasElement.prototype as { transferControlToOffscreen?: unknown }).transferControlToOffscreen;
    vi.unstubAllGlobals();
  });

  async function mount() {
    const { default: StarfieldGpu } = await import('./StarfieldGpu');
    render(<StarfieldGpu />);
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('init 之後立刻送一次當下的執行狀態（不能只靠事件）', async () => {
    enterFullscreen();
    await mount();
    const msgs = workers[0].posted;
    expect(msgs[0].type).toBe('init');
    expect(msgs[1]).toEqual({ type: 'running', value: false });
  });

  it('收到 lost → 舊 worker 收掉、換新 canvas、建新 worker', async () => {
    await mount();
    const before = canvases()[0];

    await act(async () => {
      workers[0].emit({ type: 'lost', message: 'device lost' });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(canvases()[0]).not.toBe(before);
  });
});
