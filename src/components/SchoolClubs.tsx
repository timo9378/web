import { useState } from 'react';
import { motion } from 'framer-motion';
import { FaUniversity, FaGuitar, FaCamera } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import './SchoolClubs.css';
import { pickByLang } from '../lib/pickByLang';

interface ClubEntry {
  name: string;
  role: string;
  activities: string[];
}

// 圖示 + 期間穩定,name/role/activities 隨語系
const CLUB_ICONS = [FaUniversity, FaGuitar, FaCamera];
const CLUB_PERIODS = ['2022 — 2023', '2023 — 2024', '2023 — 2024'];

const CLUBS_BY_LANG: Record<string, ClubEntry[]> = {
  'zh-TW': [
    { name: '111 屆資管系學會', role: '會長', activities: ['宿營 活動副組長', '迎新茶會 總召、主持人', '十三系聯合聖誕夜店趴 副召', '系座談會 總召、主持人'] },
    { name: '112 屆絃韻吉他社', role: '文書', activities: ['吉他太美（迎新） 總召', '詐騙吉團（期初） 攝影', '吉拜郎（民歌之夜） 副召、攝影', '七校聯展 協辦', '吉卜力（社友會） 場佈、主持人', '吉良吉影（期末） 公關組長、攝影組長', '吉惡世代（期初下） 副召、主持人', '金絃獎 文宣、內招組長'] },
    { name: '第一屆台科攝影社', role: '教學', activities: ['社課教學與規劃', '外拍活動帶領'] },
  ],
  'zh-CN': [
    { name: '111 届资管系学会', role: '会长', activities: ['宿营 活动副组长', '迎新茶会 总召、主持人', '十三系联合圣诞夜店派对 副召', '系座谈会 总召、主持人'] },
    { name: '112 届弦韵吉他社', role: '文书', activities: ['吉他太美（迎新） 总召', '诈骗吉团（期初） 摄影', '吉拜郎（民歌之夜） 副召、摄影', '七校联展 协办', '吉卜力（社友会） 场布、主持人', '吉良吉影（期末） 公关组长、摄影组长', '吉恶世代（期初下） 副召、主持人', '金弦奖 文宣、内招组长'] },
    { name: '第一届台科摄影社', role: '教学', activities: ['社课教学与规划', '外拍活动带领'] },
  ],
  en: [
    { name: 'NTUST IM Student Council (111th)', role: 'President', activities: ['Freshman Camp · Vice Activities Lead', 'Welcome Tea · Chief Organizer, MC', 'Thirteen-Dept Christmas Party · Co-Lead', 'Department Forum · Chief Organizer, MC'] },
    { name: 'NTUST Guitar Club (112th)', role: 'Secretary', activities: ['Guitar Welcome Show · Chief Organizer', 'Mid-Term Concert · Photographer', 'Folk Night · Co-Lead, Photographer', 'Seven-School Joint Exhibition · Co-organizer', 'Alumni Gathering · Set Design, MC', 'End-of-Term Show · PR Lead, Photo Lead', 'New Semester Show · Co-Lead, MC', 'Golden String Awards · PR & Recruitment Lead'] },
    { name: "NTUST Photography Club (Founding Year)", role: 'Instructor', activities: ['Workshop teaching & planning', 'Outdoor shoot leader'] },
  ],
  ja: [
    { name: 'NTUST 情報管理学生会（第111期）', role: '会長', activities: ['新入生キャンプ・活動副リーダー', '新歓茶会・総合プロデューサー、司会', '13 学科合同クリスマスパーティー・副リーダー', '学科フォーラム・総合プロデューサー、司会'] },
    { name: 'NTUST 絃韻ギター部（第112期）', role: '書記', activities: ['新歓ライブ「吉他太美」・総合プロデューサー', '学期初コンサート「詐騙吉團」・撮影', 'フォークナイト「吉拜郎」・副リーダー、撮影', '7 校合同展・共催', '部活同窓会「吉卜力」・会場設営、司会', '学期末ライブ「吉良吉影」・PR リーダー、撮影リーダー', '新学期ライブ「吉惡世代」・副リーダー、司会', 'ゴールデンストリングス賞・広報、勧誘リーダー'] },
    { name: 'NTUST 写真部（創設期）', role: '講師', activities: ['部活授業の企画・指導', '撮影遠征のリーダー'] },
  ],
  ko: [
    { name: 'NTUST 정보관리 학생회 (제111기)', role: '회장', activities: ['신입생 캠프 · 활동 부조장', '환영 다회 · 총괄, 사회', '13개 학과 합동 크리스마스 파티 · 부조장', '학과 포럼 · 총괄, 사회'] },
    { name: 'NTUST 현운 기타 동아리 (제112기)', role: '서기', activities: ['신입생 환영 공연 · 총괄', '학기 초 콘서트 · 사진', '포크 나이트 · 부총괄, 사진', '7개 학교 합동 전시 · 공동 주최', '동아리 동문회 · 무대 설치, 사회', '학기 말 공연 · 홍보 팀장, 사진 팀장', '새 학기 공연 · 부총괄, 사회', '골든 스트링 어워드 · 홍보, 모집 팀장'] },
    { name: 'NTUST 사진 동아리 (창립기)', role: '강사', activities: ['동아리 수업 기획 및 강의', '야외 촬영 리더'] },
  ],
};

function SchoolClubs() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const CLUBS = pickByLang(CLUBS_BY_LANG, lang, CLUBS_BY_LANG['zh-TW']).map((c, i) => ({
    ...c, icon: CLUB_ICONS[i], period: CLUB_PERIODS[i],
  }));
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="school-clubs" className="home-section clubs-v2">
      <div className="home-section-eyebrow">
        <span className="section-label">Communities</span>
        <span className="section-eyebrow-count">{CLUBS.length} {t('home.schoolClubs.eyebrowSuffix')}</span>
      </div>

      <div className="clubs-list">
        {CLUBS.map((club, i) => {
          const Icon = club.icon;
          const isOpen = openIndex === i;
          return (
            <motion.div
              key={club.name}
              className={`club-row glass-card ${isOpen ? 'open' : ''}`}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.08, ease: 'easeOut' }}
            >
              <button
                type="button"
                className="club-row-head"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                <span className="club-icon-wrap">
                  <Icon />
                </span>
                <div className="club-meta">
                  <span className="club-name">{club.name}</span>
                  <span className="club-role-badge">{club.role}</span>
                </div>
                <span className="club-period">{club.period}</span>
                <span className="club-count">
                  {club.activities.length} {t('home.schoolClubs.activitiesLabel')}
                  <span className={`club-caret ${isOpen ? 'open' : ''}`}>▾</span>
                </span>
              </button>

              {/* 展開動畫：CSS grid-rows 0fr→1fr（framer 的 height:auto 量測會卡） */}
              <div className={`club-activities-wrap ${isOpen ? 'open' : ''}`}>
                <ul className="club-activities-list">
                  {club.activities.map((a) => (
                    <li key={a} className="club-activity-item">{a}</li>
                  ))}
                </ul>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

export default SchoolClubs;
