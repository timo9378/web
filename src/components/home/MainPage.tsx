import NebulaBackground from '@/components/backdrop/NebulaBackground';
import Hero from './Hero';
import TransitionAnimation from '@/components/backdrop/TransitionAnimation';
import HomeLately from './HomeLately';

// 首頁內容（對齊舊 App.tsx 的 MainPage）：Hero →（過場動畫）→ Lately（含軌跡與訊號收尾）。
// section id 供導覽列 hash 跳轉（#home / #lately / #contact）。Header 的 active 已改 path-based,不需 onSectionChange。
// 全部 SSR-safe（window/document 僅在 useEffect 內）→ 直接 import 讓內容進 SSR HTML(SEO)。
export default function MainPage() {
  return (
    <>
      <NebulaBackground />
      {/* 這裡刻意**不是** <main>：AppShell 已經把整頁內容包在一個 <main> 裡了。
          再加一層會變成巢狀 main——HTML 規範只允許一個非隱藏的 main，
          螢幕閱讀器會拿到兩個「主要內容」地標。axe 實測報 landmark-no-duplicate-main
          / landmark-main-is-top-level / landmark-unique 三條（都是 moderate，
          而既有的 a11y 測試只擋 critical，所以一直沒被抓到）。
          原本沒有任何樣式掛在這個 main 上，直接拿掉即可。 */}
      <section id="home">
        <Hero />
      </section>
      <TransitionAnimation />
      <section id="lately">
        <HomeLately />
      </section>
    </>
  );
}
