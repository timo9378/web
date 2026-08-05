// @vitest-environment jsdom
//
// VideoPlayer 的狀態機測試。
//
// 為什麼是這一支：它 253 個 statement，而 e2e 只走到 6%——站上沒有任何一條測試會播影片。
// 而它偏偏出過真實的生產 bug（全螢幕 seek 卡死），且元件本身的註解就標出了幾個
// 「漏掉就會安靜壞掉」的地方（scrubbing 的四種收尾、metadata 早於 hydrate 載完）。
// 這些全是分支邏輯，e2e 便宜不了，單元測試最划算。
//
// ⚠ jsdom 沒有實作 HTMLMediaElement 的播放與 Fullscreen API。
//   下面的樁不是「為了讓測試過」，是把瀏覽器真的會做的事補上：
//   play() 會非同步地觸發 play 事件、muted 的寫入會觸發 volumechange。
//   少了這一層，測到的就只是 React 自己的 setState，跟元件的行為無關。

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPlayer from './VideoPlayer';

const SRC = '/videos/demo.mp4';

/** 讓 <video> 在 jsdom 裡有可控且會發事件的行為。回傳操控用的把手。 */
function stubMediaElement() {
  const state = { paused: true, muted: false, currentTime: 0, duration: NaN };
  const proto = HTMLMediaElement.prototype;

  const defs: Record<string, PropertyDescriptor> = {
    paused: { get: () => state.paused, configurable: true },
    duration: { get: () => state.duration, configurable: true },
    currentTime: {
      get: () => state.currentTime,
      set(this: HTMLMediaElement, v: number) {
        state.currentTime = v;
        this.dispatchEvent(new Event('timeupdate'));
      },
      configurable: true,
    },
    muted: {
      get: () => state.muted,
      set(this: HTMLMediaElement, v: boolean) {
        state.muted = v;
        this.dispatchEvent(new Event('volumechange'));
      },
      configurable: true,
    },
    play: {
      value(this: HTMLMediaElement) {
        state.paused = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
      configurable: true,
    },
    pause: {
      value(this: HTMLMediaElement) {
        state.paused = true;
        this.dispatchEvent(new Event('pause'));
      },
      configurable: true,
    },
  };
  for (const [k, d] of Object.entries(defs)) Object.defineProperty(proto, k, d);

  return {
    state,
    /** 模擬「metadata 載好了」。set 完直接發事件，跟瀏覽器一致。 */
    loadMetadata(el: HTMLMediaElement, duration: number) {
      state.duration = duration;
      el.dispatchEvent(new Event('loadedmetadata'));
    },
  };
}

/** 進度條在 jsdom 裡沒有版面，getBoundingClientRect 全是 0——手動給一個。 */
function giveLayout(el: HTMLElement, left: number, width: number) {
  el.getBoundingClientRect = () =>
    ({ left, width, right: left + width, top: 0, bottom: 0, height: 10, x: left, y: 0, toJSON: () => ({}) });
  // setPointerCapture 在 jsdom 不存在；元件自己 try/catch 了，但補上比較貼近真實
  el.setPointerCapture = vi.fn();
}

/**
 * 取元素，取不到就直接拋。
 *
 * ⚠ 不用 `as HTMLElement` 也不用 `!`：oxlint 的 `non-nullable-type-assertion-style`
 * 會叫你把前者改成後者，而 `no-non-null-assertion` 又禁止後者——兩條規則互相矛盾。
 * 這個小工具兩邊都滿足，而且測試失敗時的訊息比「read of null」有用得多。
 */
function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`測試取不到元素：${selector}`);
  return el;
}

const video = () => must<HTMLVideoElement>('video');

/**
 * 直接寫 <video> 的屬性（模擬「影片自己動了」，而不是使用者按了按鈕）。
 *
 * ⚠ 一定要包在 `act()` 裡。RTL 的 `fireEvent` 自己會包，但這裡是繞過 React 直接改 DOM
 * 屬性、由 stub 發原生事件——React 收得到，卻要等到下一次 flush 才更新畫面，
 * 於是斷言看到的是**改動前**的 DOM。症狀是「明明設了 currentTime=42，aria-valuenow 還是 0」。
 */
const driveVideo = (fn: (v: HTMLVideoElement) => void) => act(() => fn(video()));
const progress = () => screen.getByRole('slider', { name: '播放進度' });
const bar = () => must<HTMLElement>('.vp-bar');
const barVisible = () => bar().classList.contains('vp-bar--show');

let media: ReturnType<typeof stubMediaElement>;

beforeEach(() => {
  media = stubMediaElement();
  // Fullscreen API：jsdom 完全沒有
  Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true, configurable: true });
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    Object.defineProperty(document, 'fullscreenElement', { value: this, writable: true, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  document.exitFullscreen = vi.fn(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
});

afterEach(cleanup);

describe('播放與暫停', () => {
  it('大播放鍵按下去會播，播放中就不再顯示', () => {
    render(<VideoPlayer src={SRC} />);
    expect(screen.getByLabelText('播放影片')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('播放影片'));
    expect(media.state.paused).toBe(false);
    // play 事件 → setPlaying(true) → 大播放鍵消失
    expect(screen.queryByLabelText('播放影片')).toBeNull();
  });

  it('控制列的按鈕在播放與暫停之間切換，label 跟著換', () => {
    render(<VideoPlayer src={SRC} />);
    fireEvent.click(screen.getByLabelText('播放'));
    expect(media.state.paused).toBe(false);

    fireEvent.click(screen.getByLabelText('暫停'));
    expect(media.state.paused).toBe(true);
    expect(screen.getByLabelText('播放')).toBeTruthy();
  });

  it('點影片本身也能播放', () => {
    render(<VideoPlayer src={SRC} />);
    fireEvent.click(video());
    expect(media.state.paused).toBe(false);
  });
});

describe('總時長', () => {
  // 元件註解裡點名的情況：metadata 可能在 hydrate 之前就載完，
  // onLoadedMetadata 永遠不會進 React，總時長就卡在 0:00。
  it('metadata 早在掛載前就載好，也要讀得到總時長', () => {
    media.state.duration = 125;
    render(<VideoPlayer src={SRC} />);
    expect(screen.getByText(/0:00 \/ 2:05/)).toBeTruthy();
  });

  it('掛載後才 loadedmetadata 一樣讀得到', () => {
    render(<VideoPlayer src={SRC} />);
    expect(screen.getByText(/0:00 \/ 0:00/)).toBeTruthy();
    driveVideo((v) => media.loadMetadata(v, 61));
    expect(screen.getByText(/0:00 \/ 1:01/)).toBeTruthy();
  });

  it('duration 是 Infinity（某些 mp4 一開始會這樣）時顯示 0:00 而不是 NaN', () => {
    media.state.duration = Number.POSITIVE_INFINITY;
    render(<VideoPlayer src={SRC} />);
    expect(screen.getByText(/\/ 0:00/)).toBeTruthy();
  });

  it('秒數補零：連續時間的顯示不會跳成 1:5', () => {
    media.state.duration = 65;
    render(<VideoPlayer src={SRC} />);
    driveVideo((v) => { v.currentTime = 5; });
    expect(screen.getByText('0:05 / 1:05')).toBeTruthy();
  });
});

describe('進度條', () => {
  function setup(duration = 100) {
    media.state.duration = duration;
    render(<VideoPlayer src={SRC} />);
    giveLayout(progress(), 0, 200);
    return progress();
  }

  it('點在正中間 → seek 到一半', () => {
    const p = setup(100);
    fireEvent.pointerDown(p, { clientX: 100, pointerId: 1 });
    expect(media.state.currentTime).toBe(50);
  });

  it('點在條子外面會被夾在 0 與總長之間，不會 seek 到負的或超過結尾', () => {
    const p = setup(100);
    fireEvent.pointerDown(p, { clientX: -500, pointerId: 1 });
    expect(media.state.currentTime).toBe(0);
    fireEvent.pointerDown(p, { clientX: 9999, pointerId: 1 });
    expect(media.state.currentTime).toBe(100);
  });

  it('duration 還不知道的時候不 seek（避免把 currentTime 設成 NaN）', () => {
    const p = setup(Number.NaN);
    fireEvent.pointerDown(p, { clientX: 100, pointerId: 1 });
    expect(media.state.currentTime).toBe(0);
  });

  it('ARIA 的 valuenow / valuemax 跟著實際時間走', () => {
    const p = setup(100);
    driveVideo((v) => { v.currentTime = 42; });
    expect(p.getAttribute('aria-valuenow')).toBe('42');
    expect(p.getAttribute('aria-valuemax')).toBe('100');
  });

  it('鍵盤左右鍵各快轉 5 秒，而且夾在範圍內', () => {
    const p = setup(100);
    driveVideo((v) => { v.currentTime = 10; });
    fireEvent.keyDown(p, { key: 'ArrowRight' });
    expect(media.state.currentTime).toBe(15);
    fireEvent.keyDown(p, { key: 'ArrowLeft' });
    expect(media.state.currentTime).toBe(10);

    driveVideo((v) => { v.currentTime = 2; });
    fireEvent.keyDown(p, { key: 'ArrowLeft' });
    expect(media.state.currentTime).toBe(0); // 不會變成 -3

    driveVideo((v) => { v.currentTime = 98; });
    fireEvent.keyDown(p, { key: 'ArrowRight' });
    expect(media.state.currentTime).toBe(100); // 不會超過總長
  });

  it('空白鍵與 Enter 都能播放/暫停', () => {
    const p = setup(100);
    fireEvent.keyDown(p, { key: ' ' });
    expect(media.state.paused).toBe(false);
    fireEvent.keyDown(p, { key: 'Enter' });
    expect(media.state.paused).toBe(true);
  });
});

// 元件註解寫得很清楚：只聽 pointerup 會漏掉幾種收尾，任何一種漏掉，
// scrubbing 就留在 true，之後「每次滑鼠移動都在 seek」。
// 那個症狀在真實使用中極難察覺原因，所以四種收尾各釘一條。
describe('拖曳進度條的收尾', () => {
  function startScrubbing() {
    media.state.duration = 100;
    render(<VideoPlayer src={SRC} />);
    giveLayout(progress(), 0, 200);
    // 播放中且滑鼠不在上面時，控制列只有 scrubbing 才會顯示 → 拿它當 scrubbing 的觀測點
    fireEvent.click(screen.getByLabelText('播放'));
    expect(barVisible()).toBe(false);
    fireEvent.pointerDown(progress(), { clientX: 20, pointerId: 1 });
    expect(barVisible(), 'pointerDown 之後應該進入拖曳狀態').toBe(true);
  }

  for (const evt of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    it(`window 的 ${evt} 要結束拖曳`, () => {
      startScrubbing();
      fireEvent(window, new Event(evt));
      expect(barVisible(), `${evt} 沒收尾的話 scrubbing 會卡在 true`).toBe(false);
    });
  }

  it('拖到一半離開全螢幕也要收尾', () => {
    startScrubbing();
    fireEvent(document, new Event('fullscreenchange'));
    expect(barVisible()).toBe(false);
  });

  it('拖曳中滑鼠移動會持續 seek，放開之後就不再跟著動', () => {
    startScrubbing();
    fireEvent(window, new MouseEvent('pointermove', { clientX: 100 }));
    expect(media.state.currentTime).toBe(50);

    fireEvent(window, new Event('pointerup'));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 180 }));
    expect(media.state.currentTime, '放開之後還在 seek = 收尾漏了').toBe(50);
  });
});

describe('靜音', () => {
  it('按鈕切換靜音，label 跟著 volumechange 事件走（不是自己記狀態）', () => {
    render(<VideoPlayer src={SRC} />);
    fireEvent.click(screen.getByLabelText('靜音'));
    expect(media.state.muted).toBe(true);
    expect(screen.getByLabelText('取消靜音')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('取消靜音'));
    expect(media.state.muted).toBe(false);
    expect(screen.getByLabelText('靜音')).toBeTruthy();
  });

  it('影片自己被靜音（外部改動）時介面也要跟上', () => {
    render(<VideoPlayer src={SRC} />);
    driveVideo((v) => { v.muted = true; });
    expect(screen.getByLabelText('取消靜音')).toBeTruthy();
  });
});

describe('全螢幕', () => {
  it('按鈕會要求全螢幕，狀態跟著 fullscreenchange 走', () => {
    render(<VideoPlayer src={SRC} />);
    fireEvent.click(screen.getByLabelText('全螢幕'));
    expect(screen.getByLabelText('離開全螢幕')).toBeTruthy();
    expect(document.querySelector('.vp--fullscreen')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('離開全螢幕'));
    expect(screen.getByLabelText('全螢幕')).toBeTruthy();
    expect(document.querySelector('.vp--fullscreen')).toBeNull();
  });

  it('別的元素進全螢幕不會讓這個播放器以為自己在全螢幕', () => {
    render(<VideoPlayer src={SRC} />);
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.createElement('div'),
      writable: true,
      configurable: true,
    });
    fireEvent(document, new Event('fullscreenchange'));
    expect(document.querySelector('.vp--fullscreen')).toBeNull();
  });
});

describe('版面與 CLS 預留', () => {
  // 有尺寸時把 aspect-ratio 放在容器上，metadata 載入前後高度一致——
  // 這是文章頁 CLS 的主因之一（實測影片撐高 424px），拿掉不會有任何測試變紅。
  it('給了 width/height 就用 aspect-ratio 預留位置', () => {
    render(<VideoPlayer src={SRC} width={1920} height={1080} />);
    const wrap = must<HTMLElement>('.vp');
    expect(wrap.classList.contains('vp--sized')).toBe(true);
    expect(wrap.style.aspectRatio).toBe('1920 / 1080');
    expect(video().getAttribute('width')).toBe('1920');
  });

  it('沒給尺寸就不套（不能憑空編一個比例）', () => {
    render(<VideoPlayer src={SRC} />);
    const wrap = must<HTMLElement>('.vp');
    expect(wrap.classList.contains('vp--sized')).toBe(false);
    expect(wrap.style.aspectRatio).toBe('');
  });

  it('全螢幕時不套 aspect-ratio（改由 .vp--fullscreen 佔滿視窗）', () => {
    render(<VideoPlayer src={SRC} width={1920} height={1080} />);
    fireEvent.click(screen.getByLabelText('全螢幕'));
    const wrap = must<HTMLElement>('.vp');
    expect(wrap.classList.contains('vp--sized')).toBe(false);
    expect(wrap.style.aspectRatio).toBe('');
  });
});

describe('其他', () => {
  it('有 caption 才有 figcaption', () => {
    const { unmount } = render(<VideoPlayer src={SRC} caption="示範影片" />);
    expect(screen.getByText('示範影片').tagName).toBe('FIGCAPTION');
    unmount();
    render(<VideoPlayer src={SRC} />);
    expect(document.querySelector('figcaption')).toBeNull();
  });

  it('下載連結指向影片本身', () => {
    render(<VideoPlayer src={SRC} />);
    const a = screen.getByLabelText('下載影片') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(SRC);
    expect(a.hasAttribute('download')).toBe(true);
  });

  it('暫停時控制列一直露出來，播放後才會收起', () => {
    render(<VideoPlayer src={SRC} />);
    expect(barVisible(), '暫停時要看得到控制列').toBe(true);
    fireEvent.click(screen.getByLabelText('播放'));
    expect(barVisible()).toBe(false);
    fireEvent.mouseEnter(must<HTMLElement>('.vp'));
    expect(barVisible(), 'hover 時要浮出來').toBe(true);
  });
});
