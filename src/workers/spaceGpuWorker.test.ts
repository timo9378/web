// @vitest-environment jsdom
//
// 星空 worker 的訊息協定。
//
// 為什麼是這一支：這個檔案的整個存在理由就是「主執行緒與 renderer 之間的狀態轉接」，
// 而 `createStarfieldRunner` 是 async——所以每一種訊息都有「在 init 完成前抵達」的路徑。
// 那條路徑原本只有 scroll / saturn 顧到，running 漏了，而漏掉的後果不是「狀態晚一點才對」：
// runner 建好時預設是跑的，所以掉了一則 `running:false` 就等於整個全螢幕期間背景都在跑，
// 跟影片搶 GPU——那正是當初加暫停要避免的事（見 SpaceBackdropShell 的長註解）。
//
// 這裡不碰 three：mock 掉 runner 之後剩下的就是純粹的轉接邏輯，而 bug 也正好都在轉接上。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** mock 的 runner：每個方法都是 spy，順序與參數就是斷言對象 */
function makeRunner() {
  return {
    setSize: vi.fn(),
    setScroll: vi.fn(),
    setSaturn: vi.fn(),
    setRunning: vi.fn(),
    dispose: vi.fn(),
  };
}

let runner = makeRunner();
/** 解析 createStarfieldRunner 的把手——測試自己決定 init 什麼時候完成 */
let resolveInit: (() => void) | null = null;
let rejectInit: ((e: unknown) => void) | null = null;
let onDeviceLost: ((message: string) => void) | null = null;

vi.mock('../lib/starfieldGpu', () => ({
  createStarfieldRunner: vi.fn((init: { onDeviceLost?: (m: string) => void }) => {
    onDeviceLost = init.onDeviceLost ?? null;
    return new Promise((res, rej) => {
      resolveInit = () => res({ runner, backend: 'WebGPU' });
      rejectInit = rej;
    });
  }),
}));

const posted: { type: string; [k: string]: unknown }[] = [];

/** 把訊息餵給 worker（等同主執行緒 postMessage） */
const send = (data: unknown) => {
  self.onmessage?.({ data } as MessageEvent);
};

/** 送 init 並等 async 那一圈跑完 */
async function initAndSettle() {
  send({ type: 'init', canvas: {}, width: 100, height: 100, dpr: 1 });
  resolveInit?.();
  await vi.waitFor(() => expect(posted.some((m) => m.type === 'ready')).toBe(true));
}

beforeEach(async () => {
  vi.resetModules();
  runner = makeRunner();
  resolveInit = null;
  rejectInit = null;
  onDeviceLost = null;
  posted.length = 0;
  // worker 全域：模組在 import 時就掛 self.onmessage，postMessage 是它唯一的出口
  self.postMessage = vi.fn((m: unknown) => {
    posted.push(m as { type: string });
  });
  await import('./spaceGpuWorker');
});

afterEach(() => {
  self.onmessage = null;
});

describe('init 之前抵達的狀態訊息', () => {
  // 這三條是同一件事的三個面向：init 是 async，而使用者不會等它。
  it('scroll 會被記下來，ready 之後補放', async () => {
    send({ type: 'scroll', y: 420 });
    expect(runner.setScroll).not.toHaveBeenCalled(); // runner 還不存在
    await initAndSettle();
    expect(runner.setScroll).toHaveBeenCalledWith(420);
  });

  it('saturn 會被記下來，ready 之後補放', async () => {
    send({ type: 'saturn', visible: true, animate: false });
    await initAndSettle();
    expect(runner.setSaturn).toHaveBeenCalledWith(true, false);
  });

  // ⚠ 這條是這支測試存在的主因。原本 running 沒有被記下來，於是：
  // 使用者在冷啟動時就進全螢幕 → running:false 被丟掉 → init 完成後 runner 用預設值
  // 「跑」起來 → 整個全螢幕期間背景都在跟影片搶 GPU。
  it('running 也會被記下來，ready 之後補放（漏掉這條的代價是全螢幕期間背景照跑）', async () => {
    send({ type: 'running', value: false });
    await initAndSettle();
    expect(runner.setRunning).toHaveBeenCalledWith(false);
  });

  it('補放的是最後一次的值，不是第一次', async () => {
    send({ type: 'running', value: false });
    send({ type: 'running', value: true });
    send({ type: 'scroll', y: 10 });
    send({ type: 'scroll', y: 99 });
    await initAndSettle();
    expect(runner.setRunning).toHaveBeenCalledTimes(1);
    expect(runner.setRunning).toHaveBeenCalledWith(true);
    expect(runner.setScroll).toHaveBeenLastCalledWith(99);
  });

  // 沒收到過 running 就不該亂送一個預設值進去——runner 自己的預設就是跑，
  // 補一個 setRunning(true) 只是噪音，而補 false 會讓背景莫名其妙停住。
  it('沒收到過 running 就不呼叫 setRunning', async () => {
    await initAndSettle();
    expect(runner.setRunning).not.toHaveBeenCalled();
  });
});

describe('init 之後的訊息直接轉給 runner', () => {
  beforeEach(async () => {
    await initAndSettle();
  });

  it('running / scroll / saturn / resize 各自打到對應的方法', () => {
    send({ type: 'running', value: false });
    send({ type: 'scroll', y: 7 });
    send({ type: 'saturn', visible: false, animate: true });
    send({ type: 'resize', width: 800, height: 600 });
    expect(runner.setRunning).toHaveBeenCalledWith(false);
    expect(runner.setScroll).toHaveBeenCalledWith(7);
    expect(runner.setSaturn).toHaveBeenCalledWith(false, true);
    expect(runner.setSize).toHaveBeenCalledWith(800, 600);
  });

  it('ready 會帶著 backend 回報，主執行緒靠它顯示徽章並重新同步狀態', () => {
    expect(posted.find((m) => m.type === 'ready')).toEqual({ type: 'ready', backend: 'WebGPU' });
  });
});

describe('錯誤與 device lost', () => {
  it('init 失敗回報 error，而且不會讓 worker 掛掉', async () => {
    send({ type: 'init', canvas: {}, width: 1, height: 1, dpr: 1 });
    rejectInit?.(new Error('沒有 WebGPU 也沒有 WebGL2'));
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'error')).toBe(true));
    const err = posted.find((m) => m.type === 'error');
    expect(String(err?.message)).toContain('沒有 WebGPU 也沒有 WebGL2');
    // 失敗之後再送訊息不該炸（主執行緒此時可能還在收尾）
    expect(() => send({ type: 'scroll', y: 1 })).not.toThrow();
  });

  // device lost 是永久的：three 的預設處理只有 console.error 一行，而那行在 worker 裡
  // 根本不會出現在頁面 console。不轉出來的話，使用者看到的就是「星空停住、切回首頁
  // 連土星都不出現」，而且只有重整能救。
  it('device lost 轉成 lost 訊息送回主執行緒（否則沒有任何人知道 renderer 死了）', async () => {
    await initAndSettle();
    expect(onDeviceLost).toBeTypeOf('function');
    onDeviceLost?.('WebGL device lost: 測試');
    const lost = posted.find((m) => m.type === 'lost');
    expect(lost).toEqual({ type: 'lost', message: 'WebGL device lost: 測試' });
  });
});
