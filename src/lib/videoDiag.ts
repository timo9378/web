/* 影片黑畫面診斷（?debug=video）。
 *
 * 為什麼需要這個：`document.elementFromPoint()` 會跳過 `pointer-events: none` 的元素，
 * 所以「有東西蓋在影片上」這件事它查不出來；而 GPU 合成類的黑畫面又只在使用者機器上重現
 * （headless / 無 GPU 的環境測不到）。這支把兩邊都掃出來：
 *
 *   1. 祖先鏈上所有「會讓子樹進獨立 render surface / backdrop root / paint container」的屬性
 *      —— transform、filter、backdrop-filter、opacity<1、mix-blend-mode、isolation、
 *      contain、content-visibility、will-change、perspective、mask、clip-path、動畫中的 transform。
 *      <video> 一旦被關進這種 surface，跑硬體 overlay 的畫面就畫不進去 → 全黑。
 *   2. 幾何上蓋住影片中心、且畫在影片之後的元素（含 pointer-events:none）。
 *   3. 影片自身狀態 + 從畫面取樣，確認「解碼正常但合成不出來」。
 */

/** 會把子樹關進獨立 render surface / backdrop root 的屬性，值長這樣就算「有觸發」 */
const SUSPECTS: { prop: string; hit: (v: string) => boolean }[] = [
  { prop: 'transform', hit: (v) => v !== 'none' },
  { prop: 'filter', hit: (v) => v !== 'none' },
  { prop: 'backdropFilter', hit: (v) => v !== 'none' },
  { prop: 'opacity', hit: (v) => v !== '1' },
  { prop: 'mixBlendMode', hit: (v) => v !== 'normal' },
  { prop: 'isolation', hit: (v) => v !== 'auto' },
  { prop: 'contain', hit: (v) => v !== 'none' },
  { prop: 'contentVisibility', hit: (v) => v !== 'visible' },
  { prop: 'willChange', hit: (v) => v !== 'auto' },
  { prop: 'perspective', hit: (v) => v !== 'none' },
  { prop: 'transformStyle', hit: (v) => v !== 'flat' },
  { prop: 'maskImage', hit: (v) => v !== 'none' },
  { prop: 'clipPath', hit: (v) => v !== 'none' },
  { prop: 'containerType', hit: (v) => v !== 'normal' },
  { prop: 'animationName', hit: (v) => v !== 'none' },
  { prop: 'viewTransitionName', hit: (v) => v !== 'none' },
];

const tag = (el: Element) => {
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
};

export function diagnoseVideo(video: HTMLVideoElement): string {
  const out: string[] = [];
  const rect = video.getBoundingClientRect();

  out.push('── 影片狀態 ──');
  out.push(
    `readyState=${video.readyState} 尺寸=${video.videoWidth}x${video.videoHeight} ` +
      `time=${video.currentTime.toFixed(2)}/${video.duration.toFixed(2)} error=${video.error?.code ?? 'null'}`,
  );
  // 從畫面取樣：亮 → 解碼正常，黑掉的是合成階段而不是影片本身
  try {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    if (ctx && video.videoWidth > 0) {
      ctx.drawImage(video, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
        max = Math.max(max, lum);
        sum += lum;
      }
      out.push(
        `畫面取樣：最亮=${Math.round(max)} 平均=${Math.round(sum / (d.length / 4))}（亮 → 解碼沒問題，是合成掉了）`,
      );
    }
  } catch (e) {
    out.push(`畫面取樣失敗：${String(e)}`);
  }

  out.push('');
  out.push('── 祖先鏈上的合成觸發屬性（由內往外）──');
  let hits = 0;
  for (let el: Element | null = video.parentElement; el; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const found = SUSPECTS.map(({ prop, hit }) => {
      const v = cs.getPropertyValue(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
      return hit(v) ? `${prop}=${v.slice(0, 40)}` : null;
    }).filter(Boolean);
    if (found.length > 0) {
      hits += found.length;
      out.push(`${tag(el)}\n    ${found.join('  ')}`);
    }
  }
  if (hits === 0) out.push('（乾淨，祖先鏈上沒有任何觸發屬性）');

  out.push('');
  out.push('── 蓋住影片中心的元素（含 pointer-events:none，elementFromPoint 查不到的）──');
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const covering: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el === video || el.contains(video) || video.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const bg = cs.backgroundColor;
    const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    covering.push(
      `${tag(el)}  z=${cs.zIndex} pos=${cs.position} pe=${cs.pointerEvents} ` +
        `bg=${transparent ? '透明' : bg} backdrop=${cs.backdropFilter}`,
    );
  }
  out.push(covering.length > 0 ? covering.join('\n') : '（沒有元素蓋住影片中心）');

  out.push('');
  out.push(`── 其他 ──\ndevicePixelRatio=${devicePixelRatio} UA=${navigator.userAgent.slice(0, 110)}`);
  return out.join('\n');
}

/* ── 一次比完所有假設的對照組（?debug=video 的「開對照組」按鈕）──
 *
 * 一次改一個變因、部署、等回報，已經來回太多次了。這裡直接在 document.body 最上層並排
 * 開出同一支影片的多個版本，每個只差一項條件，全部 autoplay。哪一格黑、哪一格有畫面，
 * 一張截圖就分辨得出來——不必再靠推論。
 *
 * 放在 body 底下、position:fixed，是為了完全脫離文章的祖先鏈（使用者先前實測這個位置的裸
 * <video> 是正常的，所以它是這組對照的基準線）。
 */
const VARIANTS: { label: string; wrap?: Partial<CSSStyleDeclaration>; video?: Partial<CSSStyleDeclaration> }[] = [
  { label: '1 裸' },
  { label: '2 大尺寸', video: { width: '150px' } },
  { label: '3 opacity.999', video: { opacity: '0.999' } },
  { label: '4 圓角裁切', wrap: { overflow: 'hidden', borderRadius: '10px' } },
  { label: '5 動畫祖先', wrap: { animation: 'post-enter 700ms linear' } },
  { label: '6 遮罩在上', wrap: { position: 'relative' } },
  { label: '7 濾鏡祖先', wrap: { filter: 'blur(0px)' } },
  { label: '8 contain', wrap: { contain: 'paint' } },
];

export function bisectVideo(src: string): () => void {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:auto 0 0 0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;' +
    'padding:8px;background:#000;font:11px system-ui;color:#fff;justify-content:center';

  for (const v of VARIANTS) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';

    const wrap = document.createElement('div');
    Object.assign(wrap.style, v.wrap ?? {});

    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.width = '80px';
    video.style.display = 'block';
    Object.assign(video.style, v.video ?? {});
    wrap.appendChild(video);

    // 版本 6：把文章那層 75% 近黑遮罩原樣蓋上去，確認它到底會不會把畫面壓成全黑
    if (v.label.startsWith('6')) {
      const dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(6,5,14,0.75);pointer-events:none;z-index:0';
      wrap.appendChild(dim);
    }

    const tagEl = document.createElement('span');
    tagEl.textContent = v.label;
    cell.append(wrap, tagEl);
    host.appendChild(cell);
    void video.play().catch(() => {
      /* autoplay 被擋就算了，靜音的通常不會 */
    });
  }

  document.body.appendChild(host);
  return () => host.remove();
}
