// 關於我 — 從首頁移出的「履歷叢集」：About / Expertise / Work / Clubs，
// 收尾接上精簡版成長軌跡（舊 /journey 併入此頁，/journey 轉址過來）。
import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import AboutMe from './AboutMe';
import Expertise from './Expertise';
import WorkExperience from './WorkExperience';
import SchoolClubs from './SchoolClubs';
import JourneyTimeline from './JourneyTimeline';
import './AboutPage.css';

// title/description 由 head() 出（pageSeo 的 about.title / about.description，進 SSR）。
// 舊的 SEO 表 + <SEOHead>（helmet、爬蟲看不到）已隨 SEOHead 退休一併移除。
function AboutPage() {
  const hash = useRouterState({ select: (s) => s.location.hash });

  // /about#journey 之類的 hash 進場：等 section 掛載後捲過去
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(timer);
  }, [hash]);

  return (
    <div className="about-page">
      {/* 前景濾鏡：壓暗亮星空，跟 /watch /thinking 一致 */}
      <div className="about-scrim" />
      <AboutMe />
      <Expertise />
      <WorkExperience />
      <SchoolClubs />
      <JourneyTimeline />
    </div>
  );
}

export default AboutPage;
