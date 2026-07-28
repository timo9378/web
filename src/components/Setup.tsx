import { useState, type ReactElement } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { FaDesktop, FaServer, FaWifi, FaKeyboard, FaHome } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import './Setup.css';

// --- 圖片導入 ---
import img4070ti from '../assets/setup/4070ti-super.png';
import img5060ti from '../assets/setup/5060ti-16g.png';
import img9900x from '../assets/setup/9900X.png';
import imgRyzen8700g from '../assets/setup/ryzen-7-8700g.png';
import imgB650a from '../assets/setup/b650-a.png';
import imgTomahawk from '../assets/setup/tomahawk-x870e-wifi.png';
import imgDdr5_6000 from '../assets/setup/ddr5-6000.png';
import imgKingstonDdr5 from '../assets/setup/kinston-ddr5-5600.png';
import imgModel5 from '../assets/setup/Geometric-Future-Model5.png';
import imgEskimo from '../assets/setup/Geometric-Future-Eskimo.png';
import imgLeadexVii from '../assets/setup/Leadex-VII-PRO-850W.png';
import imgPrimeTx from '../assets/setup/PRIME-TX-1600-1300-PX-1600-back-panel-angled-scaled.png';
import imgCrucialT500 from '../assets/setup/Crucial-SSD-T500.png';
import imgKioxia from '../assets/setup/KIOXIA-Exceria-Pro.png';
import imgAcerSsd from '../assets/setup/acer-ssd.png';
import imgWd16tb from '../assets/setup/wd-16tb.png';
import imgXg27acs from '../assets/setup/XG27ACS.png';
import imgP10c from '../assets/setup/p10c.png';
import imgThermalright from '../assets/setup/Thermalright.png';
import imgBd5 from '../assets/setup/asus-bd5.png';
import imgQgU1050 from '../assets/setup/QG-U1050.png';
import imgPixel8 from '../assets/setup/pixel8.png';
import imgRazerBlade from '../assets/setup/razer-blade-14.png';
import imgG502x from '../assets/setup/g502-x-lightspeed.png';
import imgG502Hero from '../assets/setup/g502-hero.png';
import imgCherry31s from '../assets/setup/cherry-3.1s.png';
import imgCherry20s from '../assets/setup/Cherry-2.0s-mx2a.png';
import imgHyperxFps from '../assets/setup/HyperX-Alloy-FPS.png';
import imgPuddingKeycaps from '../assets/setup/HyperX-Pudding-Keycaps.png';
import imgPixelBuds from '../assets/setup/Pixel-buds-pro2.png';
import imgCloudII from '../assets/setup/Cloud-II-Wireless.png';
import imgQuadcast from '../assets/setup/hyperx-quadcast.png';
import imgShureMv7Plus from '../assets/setup/shure-mv7-plus.png';
import imgPsa1Plus from '../assets/setup/PSA1-plus.png';
import imgArctisNova7Gen2 from '../assets/setup/arctis-nova-7-wireless-gen-2-white.png';
import imgT100 from '../assets/setup/t100.png';

// --- 文案 i18n ---
interface SetupUi { subtitle: string; all: string; catSubs: Record<string, string>; retired: string; retiredText: string }
interface SetupItem { title: string; subtitle: string; image?: string | null; iconOnly?: boolean }
interface SetupCategory { id: string; number: string; title: string; subtitle: string; icon: ReactElement; items: SetupItem[] }

const SETUP_UI: Record<string, SetupUi> = {
  'zh-TW': {
    subtitle: 'My Gear Inventory 2026 — 所有個人配備一覽',
    all: '全部',
    catSubs: {
      'main-rig': '全白美學主力機',
      'server': 'The Lab — 效能與穩定',
      'network': 'Connectivity — 數位生活核心',
      'peripherals': 'Input / Output 周邊設備',
      'base-ii': 'Holiday Rig — 老家備用基地',
    },
    retired: '⚙️ Retired Legacy',
    retiredText: 'Family Shared PC — Powered by NVIDIA GTX 960（目前由家人使用）',
  },
  'zh-CN': {
    subtitle: 'My Gear Inventory 2026 — 所有个人配备一览',
    all: '全部',
    catSubs: {
      'main-rig': '全白美学主力机',
      'server': 'The Lab — 性能与稳定',
      'network': 'Connectivity — 数位生活核心',
      'peripherals': 'Input / Output 周边设备',
      'base-ii': 'Holiday Rig — 老家备用基地',
    },
    retired: '⚙️ Retired Legacy',
    retiredText: 'Family Shared PC — Powered by NVIDIA GTX 960（目前由家人使用）',
  },
  en: {
    subtitle: 'My Gear Inventory 2026 — everything I roll with',
    all: 'All',
    catSubs: {
      'main-rig': 'All-white main rig',
      'server': 'The Lab — power & uptime',
      'network': 'Connectivity — my digital backbone',
      'peripherals': 'Input / Output gear',
      'base-ii': 'Holiday Rig — hometown standby',
    },
    retired: '⚙️ Retired Legacy',
    retiredText: 'Family Shared PC — NVIDIA GTX 960 (still in active duty at home)',
  },
  ja: {
    subtitle: 'My Gear Inventory 2026 — 普段使ってる機材一覧',
    all: '全部',
    catSubs: {
      'main-rig': '真っ白なメインリグ',
      'server': 'The Lab — 性能と安定性',
      'network': 'Connectivity — デジタル生活の基盤',
      'peripherals': 'Input / Output の周辺機器',
      'base-ii': 'Holiday Rig — 実家の予備基地',
    },
    retired: '⚙️ Retired Legacy',
    retiredText: 'ファミリー共有 PC — NVIDIA GTX 960（家族が現役で使用中）',
  },
  ko: {
    subtitle: 'My Gear Inventory 2026 — 사용 중인 모든 장비',
    all: '전체',
    catSubs: {
      'main-rig': '올화이트 메인 PC',
      'server': 'The Lab — 성능과 안정성',
      'network': 'Connectivity — 디지털 라이프의 중심',
      'peripherals': 'Input / Output 주변기기',
      'base-ii': 'Holiday Rig — 본가 예비 베이스',
    },
    retired: '⚙️ Retired Legacy',
    retiredText: 'Family Shared PC — NVIDIA GTX 960 (현재 가족이 사용 중)',
  },
};

// --- 設備資料 ---
const categories: SetupCategory[] = [
  {
    id: 'main-rig',
    number: '01',
    title: 'The White Build',
    subtitle: '全白美學主力機',
    icon: <FaDesktop />,
    items: [
      { title: 'MSI RTX 4070 Ti Super', subtitle: 'Gaming X Slim White 16G', image: img4070ti },
      { title: 'AMD Ryzen 9 9900X', subtitle: '12-Core, 24-Thread Processor', image: img9900x },
      { title: 'ROG Strix B650-A', subtitle: 'Gaming WiFi Motherboard', image: imgB650a },
      { title: 'XPG Lancer Blade RGB', subtitle: '64GB (16GBx4) DDR5-6000 White', image: imgDdr5_6000 },
      { title: 'Geometric Future Model 5', subtitle: 'Wukong Edition (White)', image: imgModel5 },
      { title: 'Eskimo Pro 360', subtitle: '360mm AIO Liquid Cooler', image: imgEskimo },
      { title: 'Super Flower Leadex VII', subtitle: '850W Platinum ATX 3.1', image: imgLeadexVii },
      { title: 'Crucial T500 SSD', subtitle: '1TB Gen4 NVMe (System)', image: imgCrucialT500 },
      { title: 'KIOXIA Exceria Pro', subtitle: '2TB Gen4 NVMe (Games)', image: imgKioxia },
      { title: 'ROG Strix XG27ACS', subtitle: '27" 1440p Gaming Monitor', image: imgXg27acs },
    ]
  },
  {
    id: 'server',
    number: '02',
    title: 'Home Server',
    subtitle: 'The Lab — 效能與穩定',
    icon: <FaServer />,
    items: [
      { title: 'MSI RTX 5060 Ti', subtitle: 'Ventus 2X Plus 16G', image: img5060ti },
      { title: 'AMD Ryzen 7 8700G', subtitle: '8-Core Processor with AI', image: imgRyzen8700g },
      { title: 'MSI MAG X870E Tomahawk', subtitle: 'WiFi Motherboard', image: imgTomahawk },
      { title: 'Kingston FURY Beast', subtitle: '64GB (32GBx2) DDR5-5600', image: imgKingstonDdr5 },
      { title: 'Thermalright Phantom Spirit', subtitle: '120 EVO Cooler', image: imgThermalright },
      { title: 'Seasonic PRIME TX-750', subtitle: '750W Titanium PSU', image: imgPrimeTx },
      { title: 'Antec P10C', subtitle: 'Silent Mid-Tower Case', image: imgP10c },
      { title: 'Predator GM7000', subtitle: '2TB Gen4 NVMe SSD', image: imgAcerSsd },
      { title: 'WD Ultrastar HC550', subtitle: '32TB (16TBx2) HDD Pool', image: imgWd16tb },
      { title: 'Headless Adaptor', subtitle: 'DisplayPort Dummy Plug', image: null, iconOnly: true },
    ]
  },
  {
    id: 'network',
    number: '03',
    title: 'Network & Mobile',
    subtitle: 'Connectivity — 數位生活核心',
    icon: <FaWifi />,
    items: [
      { title: 'ASUS ZenWiFi BD5', subtitle: 'WiFi 7 BE5000 Mesh System', image: imgBd5 },
      { title: 'ASUS QG-U1050', subtitle: '5-Port Switch', image: imgQgU1050 },
      { title: 'Google Pixel 8 Pro', subtitle: '256GB / Bay Blue', image: imgPixel8 },
      { title: 'Razer Blade 14 (2021)', subtitle: 'Ryzen 5900HX / RTX 3070', image: imgRazerBlade },
    ]
  },
  {
    id: 'peripherals',
    number: '04',
    title: 'Peripherals',
    subtitle: 'Input / Output 周邊設備',
    icon: <FaKeyboard />,
    items: [
      // Input Devices
      { title: 'Logitech G502 X', subtitle: 'Lightspeed Wireless', image: imgG502x },
      { title: 'Logitech G502 Hero', subtitle: 'Wired Gaming Mouse', image: imgG502Hero },
      { title: 'Cherry MX Board 3.1S', subtitle: 'MX2A RGB (Silent Red)', image: imgCherry31s },
      { title: 'Cherry MX Board 2.0S', subtitle: 'Wireless / Silent Red', image: imgCherry20s },
      { title: 'Fantech Pantheon MK882', subtitle: 'w/ HyperX Pudding Keycaps', image: imgPuddingKeycaps },
      { title: 'HyperX Alloy FPS', subtitle: 'Blue Switch', image: imgHyperxFps },
      // Audio & Mic
      { title: 'Pixel Buds Pro 2', subtitle: 'Wireless Earbuds', image: imgPixelBuds },
      { title: 'HyperX Cloud II', subtitle: 'Wireless Headset', image: imgCloudII },
      { title: 'Arctis Nova 7 Wireless Gen 2', subtitle: 'White Edition Headset', image: imgArctisNova7Gen2 },
      { title: 'HyperX QuadCast', subtitle: 'USB Microphone', image: imgQuadcast },
      { title: 'Shure MV7+', subtitle: 'USB/XLR Podcast Microphone', image: imgShureMv7Plus },
      { title: 'RODE PSA1+', subtitle: 'Professional Studio Boom Arm', image: imgPsa1Plus },
      { title: 'Creative T100', subtitle: 'Hi-Fi 2.0 Speakers', image: imgT100 },
    ]
  }
];

const baseIISpecs: { label: string; value: string }[] = [
  { label: 'GPU', value: 'NVIDIA RTX 2060 Super 8GB' },
  { label: 'CPU', value: 'Intel Core i5-9400F' },
  { label: 'RAM', value: '24GB DDR4 Mixed (Corsair RGB + Kingston)' },
  { label: 'MB', value: 'Intel B360M Chipset' },
  { label: 'PSU', value: 'Super Flower Leadex III 650W Gold ARGB' },
  { label: 'Storage', value: 'Micron SATA SSD + Toshiba 1TB HDD' },
  { label: 'Case', value: 'Legacy Mid-Tower (Recycled)' },
];

// --- 動畫設定 ---
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, ease: 'easeOut' }
  }
};

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.5, ease: 'easeOut' }
  }
};

function Setup() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const ui = SETUP_UI[lang] || SETUP_UI['zh-TW'];
  const [activeFilter, setActiveFilter] = useState('all');

  const filteredCategories = activeFilter === 'all'
    ? categories
    : categories.filter(c => c.id === activeFilter);

  const totalItems = categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="setup-page">
      {/* 深空背景 */}
      <div className="setup-deep-space-bg" />

      {/* 黑洞背景裝飾 */}
      <div className="setup-blackhole-bg">
        <div className="setup-blackhole-ring setup-blackhole-ring-1" />
        <div className="setup-blackhole-ring setup-blackhole-ring-2" />
        <div className="setup-blackhole-core" />
        <div className="setup-blackhole-glow" />
      </div>

      {/* 主內容 */}
      <div className="setup-content">
      {/* Header */}
      <motion.div
        className="setup-header"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="setup-title">
          <span className="title-emoji">🖥️</span>
          <span className="title-gradient">My Setup</span>
        </h1>
        <p className="setup-subtitle">{ui.subtitle}</p>
      </motion.div>

      {/* Category Filter Tabs */}
      <motion.div
        className="setup-category-tabs"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <button
          className={`setup-category-tab ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          {ui.all}
          <span className="tab-count">{totalItems}</span>
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`setup-category-tab ${activeFilter === cat.id ? 'active' : ''}`}
            onClick={() => setActiveFilter(cat.id)}
          >
            <span className="tab-icon">{cat.icon}</span>
            {cat.title}
            <span className="tab-count">{cat.items.length}</span>
          </button>
        ))}
        <button
          className={`setup-category-tab ${activeFilter === 'base-ii' ? 'active' : ''}`}
          onClick={() => setActiveFilter('base-ii')}
        >
          <span className="tab-icon"><FaHome /></span>
          Base II
          <span className="tab-count">{baseIISpecs.length}</span>
        </button>
      </motion.div>

      {/* Equipment Grid Sections */}
      <AnimatePresence mode="wait">
        {(activeFilter === 'all' || activeFilter !== 'base-ii') && filteredCategories.map(category => (
          <motion.div
            key={category.id}
            className="setup-category-section"
            variants={sectionVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
          >
            <div className="setup-category-header">
              <span className="setup-category-number">{category.number}</span>
              <h2 className="setup-category-title">{category.title}</h2>
              <span className="setup-category-subtitle">{ui.catSubs[category.id] || category.subtitle}</span>
            </div>

            <motion.div
              className="setup-grid"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-30px' }}
            >
              {category.items.map((item) => (
                <motion.div
                  key={`${category.id}-${item.title}`}
                  className="setup-card"
                  variants={cardVariants}
                  whileHover={{ y: -5 }}
                >
                  {item.iconOnly ? (
                    <div className="setup-card-icon-wrapper">🔌</div>
                  ) : (
                    <div className="setup-card-image-wrapper">
                      <img
                        src={item.image ?? undefined}
                        alt={item.title}
                        className="setup-card-image"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  )}
                  <h3 className="setup-card-title">{item.title}</h3>
                  <p className="setup-card-subtitle">{item.subtitle}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        ))}

        {/* Base II Section */}
        {(activeFilter === 'all' || activeFilter === 'base-ii') && (
          <motion.div
            className="setup-base-section"
            variants={sectionVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
          >
            <div className="setup-category-header">
              <span className="setup-category-number">05</span>
              <h2 className="setup-category-title">Base II: Hometown</h2>
              <span className="setup-category-subtitle">{ui.catSubs['base-ii']}</span>
            </div>

            <div className="setup-base-card">
              <p className="setup-base-quote">
                "Built from spare parts and memories. Ready for action whenever I return home."
              </p>

              <div className="setup-base-specs">
                {baseIISpecs.map((spec, idx) => (
                  <motion.div
                    key={spec.label}
                    className="setup-base-spec-item"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.05 }}
                    viewport={{ once: true }}
                  >
                    <span className="setup-base-spec-label">{spec.label}</span>
                    <span className="setup-base-spec-value">{spec.value}</span>
                  </motion.div>
                ))}
              </div>

              <div className="setup-retired-section">
                <p className="setup-retired-title">{ui.retired}</p>
                <p className="setup-retired-text">{ui.retiredText}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}

export default Setup;
