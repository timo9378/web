import { useState, type ChangeEvent, type FormEvent } from 'react';
import { LocaleLink } from '../locale-link';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import InfoPage from './InfoPage';
import { lookupOr } from '../lib/tableLookup';

interface Friend { name: string; url: string; avatar?: string; tagline?: string }
interface FailedSite { name: string; url: string }
interface BlacklistSite { name: string; reason?: string }
interface FriendForm { name: string; site: string; url: string; avatar: string; email: string; tagline: string }

/**
 * 友鏈列表 — 之後手動加，格式：{ name, url, avatar, tagline }
 * 還沒人就讓它空著，頁面會顯示「歡迎成為第一個」。
 */
const FRIENDS: Friend[] = [];

const FAILED: FailedSite[] = [];        // 失聯的（網站掛了/換域名等）
const BLACKLIST: BlacklistSite[] = [];     // 黑名單（違規/變廣告農場）

// 本站訊息卡 — 給對方寫進他們的友鏈頁
const SITE_INFO = {
  name: '宙と木',
  url: 'https://koimsurai.com',
  desc_zhTW: '一個工程師的個人空間',
  desc_zhCN: '一个工程师的个人空间',
  desc_en: 'A developer\'s personal corner',
  desc_ja: 'あるエンジニアの個人スペース',
  desc_ko: '한 엔지니어의 개인 공간',
  // 永久分享連結（自製 NAS）— 如果 NAS 掛了/重開後失效，把這個換掉
  avatar: 'https://nas.koimsurai.com/s/99881e40-51d4-4ea2-8dbd-47692f6343ff',
};

const FRIENDS_BY_LANG: Record<string, Record<string, string>> = {
  'zh-TW': {
    intro: '友鏈的中文圈起源像是古早 SEO 時代「我貼你、你貼我」的互助文化。對我來說更像「我在這片網海裡看見了你，幫你掛個牌子」。',
    listHeading: '目前的朋友',
    emptyList: '── 還沒有人，這裡空著。歡迎成為第一個。 ──',
    failedHeading: '以下站點無法訪問，已失聯',
    blacklistHeading: '以下站點不合規，已被禁止',
    applyHeading: '想交換友鏈？',
    applyIntro: '幾個小前提：',
    rule1: '站點目前能正常瀏覽（沒過期 / 沒掛掉）。',
    rule2: '有原創內容（轉貼站、純廣告、SEO 農場恕不交換）。',
    rule3: 'HTTPS、有自己的域名（不限 .com / .tw / .moe，免費 subdomain 也可）。',
    rule4: '如果你願意先在你站上掛我的連結，我會更快回覆。',
    siteCardLabel: '本站的訊息卡：',
    cardName: '站點名稱：',
    cardUrl: '站點地址：',
    cardDesc: '站點描述：',
    cardAvatar: '頭像：',
    cardAvatarLink: '連結',
    contactPre: '想申請的話，可以點下方按鈕填表（會幫你開信件用戶端寄出），或直接到 ',
    contactLink: '留言頁',
    contactPost1: ' 留言、寄信到 ',
    contactPost2: '。',
    applyBtn: '來交個朋友',
    desc: SITE_INFO.desc_zhTW,
  },
  'zh-CN': {
    intro: '友链的中文圈起源像是古早 SEO 时代「我贴你、你贴我」的互助文化。对我来说更像「我在这片网海里看见了你，帮你挂个牌子」。',
    listHeading: '目前的朋友',
    emptyList: '── 还没有人，这里空着。欢迎成为第一个。 ──',
    failedHeading: '以下站点无法访问，已失联',
    blacklistHeading: '以下站点不合规，已被禁止',
    applyHeading: '想交换友链？',
    applyIntro: '几个小前提：',
    rule1: '站点目前能正常浏览（没过期 / 没挂掉）。',
    rule2: '有原创内容（转贴站、纯广告、SEO 农场恕不交换）。',
    rule3: 'HTTPS、有自己的域名（不限 .com / .tw / .moe，免费 subdomain 也可）。',
    rule4: '如果你愿意先在你站上挂我的连结，我会更快回复。',
    siteCardLabel: '本站的讯息卡：',
    cardName: '站点名称：',
    cardUrl: '站点地址：',
    cardDesc: '站点描述：',
    cardAvatar: '头像：',
    cardAvatarLink: '链接',
    contactPre: '想申请的话，可以点下方按钮填表（会帮你开邮件客户端寄出），或直接到 ',
    contactLink: '留言页',
    contactPost1: ' 留言、寄信到 ',
    contactPost2: '。',
    applyBtn: '来交个朋友',
    desc: SITE_INFO.desc_zhCN,
  },
  en: {
    intro: 'The Chinese-web tradition of "friend links" comes from the old SEO days — "I link you, you link me". To me it feels more like "I saw you in this big sea, here\'s a little name plate".',
    listHeading: 'Current friends',
    emptyList: '── No one yet — this space is empty. Be the first. ──',
    failedHeading: 'Sites below are no longer reachable',
    blacklistHeading: 'Sites below violated the rules and are blocked',
    applyHeading: 'Want to swap links?',
    applyIntro: 'A few small prerequisites:',
    rule1: 'The site is reachable right now (not expired or dead).',
    rule2: 'It has original content (no scrapers, pure ads, or SEO farms).',
    rule3: 'HTTPS and your own domain (any TLD is fine, free subdomains too).',
    rule4: 'If you\'re willing to put my link on your site first, I\'ll reply faster.',
    siteCardLabel: 'This site\'s info card:',
    cardName: 'Site name: ',
    cardUrl: 'Site URL: ',
    cardDesc: 'Description: ',
    cardAvatar: 'Avatar: ',
    cardAvatarLink: 'link',
    contactPre: 'To apply, click the button below to fill the form (it opens your mail client), or jump to ',
    contactLink: 'the messages page',
    contactPost1: ', or just email ',
    contactPost2: '.',
    applyBtn: 'Let\'s be friends',
    desc: SITE_INFO.desc_en,
  },
  ja: {
    intro: '中国語圏のフレンドリンクは、SEO 黎明期の「お互いリンクし合う」文化から来ています。私にとっては「このネットの海で君を見かけたから、看板を一枚立てておくよ」という感覚に近いです。',
    listHeading: '現在のともだち',
    emptyList: '── まだ誰もいません。最初のひとりになりませんか。 ──',
    failedHeading: '以下のサイトはアクセスできず、リンク切れになっています',
    blacklistHeading: '以下のサイトはルール違反のためブロック中',
    applyHeading: 'フレンドリンクを交換したい？',
    applyIntro: '小さな前提：',
    rule1: 'サイトが今アクセス可能（期限切れ / ダウンしていない）。',
    rule2: 'オリジナルのコンテンツがある（転載サイト・純広告・SEO ファームはご遠慮ください）。',
    rule3: 'HTTPS で、自分のドメインがある（.com / .tw / .moe など何でも OK、無料サブドメインも可）。',
    rule4: '先にそちらのサイトに私のリンクを掛けていただけると、返信が早くなります。',
    siteCardLabel: '当サイトの情報カード：',
    cardName: 'サイト名：',
    cardUrl: 'サイト URL：',
    cardDesc: 'サイト紹介：',
    cardAvatar: 'アバター：',
    cardAvatarLink: 'リンク',
    contactPre: '申請するには、下のボタンからフォームを送ってください（メールクライアントを開きます）。または ',
    contactLink: 'メッセージページ',
    contactPost1: ' にコメント、もしくは ',
    contactPost2: ' へメールでも OK です。',
    applyBtn: 'ともだちになろう',
    desc: SITE_INFO.desc_ja,
  },
  ko: {
    intro: '중화권의 「프렌드 링크」 문화는 옛 SEO 시대의 「내가 너 걸고, 너도 나 걸어주기」에서 왔어요. 저에겐 「이 네트의 바다에서 당신을 봤어요, 작은 명패 하나 걸어둘게요」에 가깝습니다.',
    listHeading: '현재의 친구들',
    emptyList: '── 아직 아무도 없어요. 비어 있는 이 자리, 첫 번째가 되어 주세요. ──',
    failedHeading: '아래 사이트들은 접속할 수 없어 연결이 끊겼습니다',
    blacklistHeading: '아래 사이트들은 규정 위반으로 차단되었습니다',
    applyHeading: '프렌드 링크 교환을 원하세요?',
    applyIntro: '작은 전제 몇 가지:',
    rule1: '사이트가 현재 접근 가능할 것 (만료/다운 상태 아님).',
    rule2: '오리지널 콘텐츠가 있을 것 (퍼옴 사이트·순수 광고·SEO 농장은 사양합니다).',
    rule3: 'HTTPS, 본인 도메인 보유 (.com / .tw / .moe 모두 OK, 무료 서브도메인도 가능).',
    rule4: '먼저 본인 사이트에 제 링크를 걸어 주시면 답장이 더 빠릅니다.',
    siteCardLabel: '본 사이트의 정보 카드:',
    cardName: '사이트명: ',
    cardUrl: '사이트 주소: ',
    cardDesc: '사이트 소개: ',
    cardAvatar: '아바타: ',
    cardAvatarLink: '링크',
    contactPre: '신청하려면 아래 버튼을 눌러 폼을 보내주세요(메일 클라이언트가 열립니다). 또는 ',
    contactLink: '메시지 페이지',
    contactPost1: ' 에 댓글, 혹은 ',
    contactPost2: ' 로 메일도 환영합니다.',
    applyBtn: '친구해요',
    desc: SITE_INFO.desc_ko,
  },
};

const FORM_BY_LANG: Record<string, Record<string, string>> = {
  'zh-TW': {
    modalTitle: '來自網海的問候',
    close: '關閉',
    success1: '已準備好你的訊息，正在開啟信件用戶端…',
    success2_pre: '如果沒有自動開啟，可以直接寄到',
    successBtn: '關閉',
    name: '你的名字',
    site: '站點名稱',
    url: '網站連結',
    avatar: '頭像連結',
    email: 'Email',
    tagline: '一句自介',
    taglinePlaceholder: '想說什麼都可以，30 字以內',
    submit: '送出',
  },
  'zh-CN': {
    modalTitle: '来自网海的问候',
    close: '关闭',
    success1: '已准备好你的讯息，正在开启邮件客户端…',
    success2_pre: '如果没有自动开启，可以直接寄到',
    successBtn: '关闭',
    name: '你的名字',
    site: '站点名称',
    url: '网站链接',
    avatar: '头像链接',
    email: 'Email',
    tagline: '一句自介',
    taglinePlaceholder: '想说什么都可以，30 字以内',
    submit: '送出',
  },
  en: {
    modalTitle: 'A hi from the sea of net',
    close: 'Close',
    success1: 'Your message is ready — opening your mail client…',
    success2_pre: 'If it doesn\'t open automatically, just email',
    successBtn: 'Close',
    name: 'Your name',
    site: 'Site name',
    url: 'Site URL',
    avatar: 'Avatar URL',
    email: 'Email',
    tagline: 'One-liner intro',
    taglinePlaceholder: 'Anything, within 50 chars',
    submit: 'Send',
  },
  ja: {
    modalTitle: 'ネットの海からのご挨拶',
    close: '閉じる',
    success1: 'メッセージの準備ができました。メールクライアントを開きます…',
    success2_pre: '自動で開かない場合は、直接こちらまで：',
    successBtn: '閉じる',
    name: 'お名前',
    site: 'サイト名',
    url: 'サイト URL',
    avatar: 'アバター URL',
    email: 'Email',
    tagline: 'ひとこと自己紹介',
    taglinePlaceholder: '何でも OK、50 文字以内',
    submit: '送信',
  },
  ko: {
    modalTitle: '네트워크 바다에서 보내는 인사',
    close: '닫기',
    success1: '메시지가 준비됐어요. 메일 클라이언트를 여는 중…',
    success2_pre: '자동으로 열리지 않으면, 직접 보내주세요:',
    successBtn: '닫기',
    name: '이름',
    site: '사이트명',
    url: '사이트 URL',
    avatar: '아바타 URL',
    email: 'Email',
    tagline: '한 줄 자기소개',
    taglinePlaceholder: '뭐든 OK, 50자 이내',
    submit: '보내기',
  },
};

function ApplicationForm({ onClose }: { onClose: () => void }) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const f = lookupOr(FORM_BY_LANG, lang, FORM_BY_LANG['zh-TW']);
  const [form, setForm] = useState<FriendForm>({
    name: '', site: '', url: '', avatar: '', email: '', tagline: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const update = (key: keyof FriendForm) => (e: ChangeEvent<HTMLInputElement>) => setForm((s) => ({ ...s, [key]: e.target.value }));

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const subject = `[Friend-link] ${form.site || form.name}`;
    const body = [
      `Name: ${form.name}`,
      `Site: ${form.site}`,
      `URL: ${form.url}`,
      `Avatar: ${form.avatar}`,
      `Email: ${form.email}`,
      `Intro: ${form.tagline}`,
    ].join('\n');
    const mailto = `mailto:timo9378@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitted(true);
    setTimeout(() => {
      window.location.href = mailto;
    }, 400);
  };

  return (
    <motion.div
      className="friends-modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="friends-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="friends-modal-header">
          <h3>{f.modalTitle}</h3>
          <button type="button" className="friends-modal-close" onClick={onClose} aria-label={f.close}>
            <FaTimes />
          </button>
        </div>

        {submitted ? (
          <div className="friends-modal-success">
            <p>{f.success1}</p>
            <p style={{ fontSize: '0.85rem', opacity: 0.6 }}>
              {f.success2_pre} <code>timo9378@gmail.com</code>.
            </p>
            <button type="button" className="friends-modal-submit" onClick={onClose}>
              {f.successBtn}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="friends-modal-form">
            <div className="friends-modal-grid">
              <label className="friends-modal-field">
                <span>{f.name} <span className="req">*</span></span>
                <input
                  type="text" required value={form.name} onChange={update('name')}
                  placeholder="Koimsurai"
                />
              </label>
              <label className="friends-modal-field">
                <span>{f.site} <span className="req">*</span></span>
                <input
                  type="text" required value={form.site} onChange={update('site')}
                  placeholder="宙と木"
                />
              </label>
              <label className="friends-modal-field">
                <span>{f.url} <span className="req">*</span></span>
                <input
                  type="url" required value={form.url} onChange={update('url')}
                  placeholder="https://"
                />
              </label>
              <label className="friends-modal-field">
                <span>{f.avatar} <span className="req">*</span></span>
                <input
                  type="url" required value={form.avatar} onChange={update('avatar')}
                  placeholder="https://"
                />
              </label>
              <label className="friends-modal-field friends-modal-field--full">
                <span>{f.email} <span className="req">*</span></span>
                <input
                  type="email" required value={form.email} onChange={update('email')}
                  placeholder="me@example.com"
                />
              </label>
              <label className="friends-modal-field friends-modal-field--full">
                <span>{f.tagline} <span className="req">*</span></span>
                <input
                  type="text" required value={form.tagline} onChange={update('tagline')}
                  placeholder={f.taglinePlaceholder}
                  maxLength={50}
                />
              </label>
            </div>

            <div className="friends-modal-actions">
              <button type="submit" className="friends-modal-submit">{f.submit}</button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

function Friends() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const c = lookupOr(FRIENDS_BY_LANG, lang, FRIENDS_BY_LANG['zh-TW']);
  const [showForm, setShowForm] = useState(false);

  return (
    <InfoPage
      title={t('info.friends.title')}
      subtitle={t('info.friends.subtitle')}
      slug="friends"
      prev={null}
      next={null}
    >
      <p>{c.intro}</p>

      <h2 id="list">{c.listHeading}</h2>

      {FRIENDS.length === 0 ? (
        <p style={{ color: 'rgba(229,229,245,0.5)', fontStyle: 'italic' }}>
          {c.emptyList}
        </p>
      ) : (
        <div className="friends-grid">
          {FRIENDS.map((fr) => (
            <a
              key={fr.url}
              href={fr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="friend-card"
              // 卡片文字在巢狀第 3 層，規則的 depth 只看 2 層；補上 aria-label 之後
              // 報讀器念的是朋友名稱，而不是「名稱＋一句標語」黏成一串
              aria-label={fr.name}
            >
              <img src={fr.avatar} alt="" width="40" height="40" className="friend-card-avatar" loading="lazy" />
              <div className="friend-card-info">
                <div className="friend-card-name">{fr.name}</div>
                <div className="friend-card-tagline">{fr.tagline}</div>
              </div>
            </a>
          ))}
        </div>
      )}

      {FAILED.length > 0 && (
        <>
          <h3 id="failed">{c.failedHeading}</h3>
          <ul>
            {FAILED.map((fr) => <li key={fr.name}>{fr.name} — {fr.url}</li>)}
          </ul>
        </>
      )}

      {BLACKLIST.length > 0 && (
        <>
          <h3 id="blacklist">{c.blacklistHeading}</h3>
          <ul>
            {BLACKLIST.map((fr) => <li key={fr.name}>{fr.name} — {fr.reason}</li>)}
          </ul>
        </>
      )}

      <h2 id="apply">{c.applyHeading}</h2>
      <p>{c.applyIntro}</p>
      <ol>
        <li>{c.rule1}</li>
        <li>{c.rule2}</li>
        <li>{c.rule3}</li>
        <li>{c.rule4}</li>
      </ol>

      <p>{c.siteCardLabel}</p>
      <ul>
        <li>{c.cardName}<code>{SITE_INFO.name}</code></li>
        <li>{c.cardUrl}<code>{SITE_INFO.url}</code></li>
        <li>{c.cardDesc}{c.desc}</li>
        <li>{c.cardAvatar}<a href={SITE_INFO.avatar} target="_blank" rel="noopener noreferrer"><code>{c.cardAvatarLink}</code></a></li>
      </ul>

      <p>
        {c.contactPre}
        <LocaleLink to="/messages">{c.contactLink}</LocaleLink>
        {c.contactPost1}
        <a href="mailto:timo9378@gmail.com">timo9378@gmail.com</a>
        {c.contactPost2}
      </p>

      <div style={{ marginTop: '1.5rem' }}>
        <button
          type="button"
          className="friends-apply-btn"
          onClick={() => setShowForm(true)}
        >
          {c.applyBtn}
        </button>
      </div>

      <AnimatePresence>
        {showForm && <ApplicationForm onClose={() => setShowForm(false)} />}
      </AnimatePresence>
    </InfoPage>
  );
}

export default Friends;
