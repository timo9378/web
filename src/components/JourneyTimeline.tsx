// 成長軌跡 — 精簡編輯版（取代舊 /journey 的一屏一里程碑排場，併入 /about）。
// 視覺沿用 WorkExperience 的 rail 語言：左欄年份 + 線上彩色光點，右欄玻璃內容。
import { motion } from 'framer-motion';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { YEAR_LABELS, JOURNEY_UI, MILESTONE_STATIC, MILESTONES_BY_LANG } from '../data/journeyData';
import './JourneyTimeline.css';
import { lookupOr } from '../lib/tableLookup';

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5, ease: 'easeOut' },
} as const;

// 職位類里程碑（猿創力 4 / 高偉 5 / MSI 7）跟同頁的 Experience 區完全重疊，
// 軌跡只保留人生敘事：出生 → 日料店啟蒙 → 大學前期 → 畢業專題 → 個人專案 → 持續探索。
// 資料仍完整保留在 journeyData.ts，想恢復把 id 從這個集合拿掉即可。
const DEDUP_WITH_EXPERIENCE = new Set([4, 5, 7]);

function JourneyTimeline() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const ylabels = lookupOr(YEAR_LABELS, lang, YEAR_LABELS['zh-TW']);
  const ui = lookupOr(JOURNEY_UI, lang, JOURNEY_UI['zh-TW']);
  const locale = lookupOr(MILESTONES_BY_LANG, lang, MILESTONES_BY_LANG['zh-TW']);
  const milestones = MILESTONE_STATIC.map((s, i) => ({
    ...s,
    year: s.year === 'NOW' ? ylabels.NOW : s.year === 'FUTURE' ? ylabels.FUTURE : s.year,
    isFuture: s.year === 'FUTURE',
    ...locale[i],
    // extraTags 在 MilestoneLang 是必填；locale 與 MILESTONE_STATIC 平行（上一行的 spread 已假設如此）
    allTags: [...s.tags, ...locale[i].extraTags],
  })).filter((m) => !DEDUP_WITH_EXPERIENCE.has(m.id));

  return (
    <section id="journey" className="home-section journey-v2">
      <div className="home-section-eyebrow">
        <span className="section-label">Journey</span>
        <span className="section-eyebrow-count">{ui.title}</span>
      </div>

      <div className="jt-timeline">
        {milestones.map((m, i) => (
          <motion.div className={`jt-entry ${m.isFuture ? 'jt-entry--future' : ''}`} key={m.id} {...reveal} transition={{ ...reveal.transition, delay: Math.min(i * 0.05, 0.3) }}>
            <aside className="jt-rail">
              <span className="jt-rail-dot" style={{ '--dot': m.color } as CSSProperties} />
              <span className="jt-year">{m.year}</span>
            </aside>
            <div className="jt-card glass-card">
              <h3 className="jt-title">{m.title}</h3>
              <p className="jt-subtitle">{m.subtitle}</p>
              <p className="jt-desc">{m.description}</p>
              {m.allTags.length > 0 && (
                <div className="jt-tags">
                  {m.allTags.map((t) => <span className="jt-tag" key={t}>{t}</span>)}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <p className="jt-ending">{ui.endingTitle}</p>
    </section>
  );
}

export default JourneyTimeline;
