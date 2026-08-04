import { useTranslation } from 'react-i18next';
import InfoPage from './InfoPage';
import { lookupOr } from '@/lib/tableLookup';

const MESSAGES_BY_LANG: Record<string, Record<string, string>> = {
  'zh-TW': {
    intro: '這裡是留言板。不一定要跟文章相關，閒聊、技術問題、合作邀請、單純路過想留個記號都歡迎。',
    rulesHeading: '幾個小規則',
    rule1Title: '用真實一點的暱稱',
    rule1Body: '不限定本名，但希望別是「123」「test」這種我會分不清是同一人還是不同人。',
    rule2Title: '登入留言會自動帶頭像',
    rule2Body: '用 GitHub / Google 登入後，頭像跟暱稱會自動填入。匿名也可以，只是需要手動輸入。',
    rule3Title: '留言會經過審核',
    rule3Body: '預設不會直接公開，避免廣告 / spam。一般留言通常 24 小時內會過。',
    rule4Title: '支援 Markdown',
    rule4Body_pre: '可以用',
    rule4Body_mid1: '、',
    rule4Body_mid2: '等基本語法。',
    contactHeading: '想私下聊？',
    contactPre: '如果是不適合公開的訊息，可以直接寄信給我：',
    contactMid: '，或從',
    contactLinkLabel: '聯絡區塊',
    contactPost: '看其他聯絡方式。',
    issuesPre: '若是 bug 回報或功能建議，建議去',
    issuesPost: '開單，比較好追蹤。',
  },
  'zh-CN': {
    intro: '这里是留言板。不一定要跟文章相关，闲聊、技术问题、合作邀请、单纯路过想留个记号都欢迎。',
    rulesHeading: '几个小规则',
    rule1Title: '用真实一点的昵称',
    rule1Body: '不限定本名，但希望别是「123」「test」这种我会分不清是同一人还是不同人。',
    rule2Title: '登入留言会自动带头像',
    rule2Body: '用 GitHub / Google 登入后，头像跟昵称会自动填入。匿名也可以，只是需要手动输入。',
    rule3Title: '留言会经过审核',
    rule3Body: '预设不会直接公开，避免广告 / spam。一般留言通常 24 小时内会过。',
    rule4Title: '支援 Markdown',
    rule4Body_pre: '可以用',
    rule4Body_mid1: '、',
    rule4Body_mid2: '等基本语法。',
    contactHeading: '想私下聊？',
    contactPre: '如果是不适合公开的讯息，可以直接寄信给我：',
    contactMid: '，或从',
    contactLinkLabel: '联络区块',
    contactPost: '查看其他联络方式。',
    issuesPre: '若是 bug 回报或功能建议，建议去',
    issuesPost: '开单，比较好追踪。',
  },
  en: {
    intro: 'This is the message board. It does not have to be about the posts — chit-chat, tech questions, collab pitches, or just a "hi I was here" all welcome.',
    rulesHeading: 'A few small rules',
    rule1Title: 'Use a slightly real nickname',
    rule1Body: 'No need for your real name, but please avoid things like "123" or "test" — I won\'t be able to tell whether it\'s one person or several.',
    rule2Title: 'Logged-in comments auto-fill your avatar',
    rule2Body: 'Sign in with GitHub or Google and your avatar and nickname auto-fill. Anonymous is fine too, just type them in.',
    rule3Title: 'Comments are moderated',
    rule3Body: 'They don\'t go public by default — keeps ads and spam out. Normal comments usually go through within 24h.',
    rule4Title: 'Markdown supported',
    rule4Body_pre: 'You can use',
    rule4Body_mid1: ', ',
    rule4Body_mid2: 'and other basic syntax.',
    contactHeading: 'Want to chat privately?',
    contactPre: 'For things that don\'t belong in public, just email me:',
    contactMid: ', or check the',
    contactLinkLabel: 'contact section',
    contactPost: 'for other ways to reach me.',
    issuesPre: 'For bug reports or feature suggestions, file an issue on',
    issuesPost: 'so it\'s easier to track.',
  },
  ja: {
    intro: 'ここはメッセージボードです。記事と関係なくても OK で、雑談・技術的な質問・コラボのお誘い・「通りすがりに足あと残したい」だけでも歓迎です。',
    rulesHeading: 'ちょっとしたルール',
    rule1Title: '本名っぽいニックネームで',
    rule1Body: '本名でなくて構いませんが、「123」「test」みたいに同じ人なのか別人なのか分からない名前は避けてください。',
    rule2Title: 'ログインするとアバターが自動入力',
    rule2Body: 'GitHub / Google でログインすると、アバターとニックネームが自動で入ります。匿名でも OK で、その場合は手入力で。',
    rule3Title: 'コメントは審査します',
    rule3Body: 'デフォルトでは公開されません（広告 / spam 対策）。普通のコメントなら通常 24 時間以内に通します。',
    rule4Title: 'Markdown 対応',
    rule4Body_pre: '次のような基本構文が使えます：',
    rule4Body_mid1: '、',
    rule4Body_mid2: 'など。',
    contactHeading: '個別に話したい？',
    contactPre: '公開向きでない内容は、直接メールしてください：',
    contactMid: 'または',
    contactLinkLabel: 'コンタクトセクション',
    contactPost: 'から他の連絡手段も見られます。',
    issuesPre: 'バグ報告や機能提案は、追跡しやすいので',
    issuesPost: 'で issue を立ててもらえると助かります。',
  },
  ko: {
    intro: '여기는 메시지 보드입니다. 글 내용과 직접 관련 없어도 괜찮고, 잡담·기술 질문·협업 제안·그냥 발자국만 남기고 가는 것도 모두 환영입니다.',
    rulesHeading: '작은 규칙 몇 가지',
    rule1Title: '조금은 진짜 같은 닉네임으로',
    rule1Body: '본명일 필요는 없지만, 「123」「test」처럼 같은 사람인지 다른 사람인지 구분이 안 되는 닉네임은 피해 주세요.',
    rule2Title: '로그인 댓글은 아바타가 자동 입력',
    rule2Body: 'GitHub / Google 로 로그인하면 아바타와 닉네임이 자동으로 채워집니다. 익명도 가능하고, 그 경우 직접 입력하시면 됩니다.',
    rule3Title: '댓글은 검토 후 공개',
    rule3Body: '기본적으로 바로 공개되지 않습니다 — 광고/스팸 방지용이에요. 일반 댓글이라면 보통 24시간 안에 통과시킵니다.',
    rule4Title: 'Markdown 지원',
    rule4Body_pre: '다음 같은 기본 문법을 쓸 수 있어요:',
    rule4Body_mid1: ', ',
    rule4Body_mid2: '등.',
    contactHeading: '개인적으로 얘기하고 싶다면?',
    contactPre: '공개에 적합하지 않은 내용이라면 메일로 직접 보내주세요:',
    contactMid: ', 다른 연락 수단은',
    contactLinkLabel: '연락 섹션',
    contactPost: '에서 확인할 수 있습니다.',
    issuesPre: '버그 제보나 기능 제안은 추적이 쉬운',
    issuesPost: '에 issue 를 올려주시면 좋습니다.',
  },
};

function Messages() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const c = lookupOr(MESSAGES_BY_LANG, lang, MESSAGES_BY_LANG['zh-TW']);

  return (
    <InfoPage
      title={t('info.messages.title')}
      subtitle={t('info.messages.subtitle')}
      slug="messages"
      prev={{ to: '/history', title: `${t('info.history.title')} — ${t('info.history.subtitle')}` }}
      next={{ to: '/friends', title: `${t('info.friends.title')} — ${t('info.friends.subtitle')}` }}
    >
      <p>{c.intro}</p>

      <h2 id="rules">{c.rulesHeading}</h2>

      <ol>
        <li>
          <strong>{c.rule1Title}</strong> — {c.rule1Body}
        </li>
        <li>
          <strong>{c.rule2Title}</strong> — {c.rule2Body}
        </li>
        <li>
          <strong>{c.rule3Title}</strong> — {c.rule3Body}
        </li>
        <li>
          <strong>{c.rule4Title}</strong> — {c.rule4Body_pre} <code>**bold**</code>{c.rule4Body_mid1}<code>`code`</code>{c.rule4Body_mid1}<code>[link](url)</code> {c.rule4Body_mid2}
        </li>
      </ol>

      <h2 id="contact">{c.contactHeading}</h2>

      <p>
        {c.contactPre}
        <a href="mailto:timo9378@gmail.com">timo9378@gmail.com</a>
        {c.contactMid} <a href="/#contact">{c.contactLinkLabel}</a> {c.contactPost}
      </p>

      <p>
        {c.issuesPre}
        <a href="https://github.com/timo9378/web/issues" target="_blank" rel="noopener noreferrer"> GitHub Issues </a>
        {c.issuesPost}
      </p>
    </InfoPage>
  );
}

export default Messages;
