import { LocaleLink } from '@/i18n/locale-link';
import { useTranslation } from 'react-i18next';
import InfoPage from './InfoPage';
import { LinkCard } from '@/components/common/LinkCard';
import { lookupOr } from '@/lib/tableLookup';

const ABOUT_SITE_BY_LANG = {
  'zh-TW': {
    intro: '此站點是我用來記錄技術與生活的個人網站，從 2025 年 4 月起持續寫到現在。',
    qaHeading: '常見問題 Q&A',
    q1: '1. 建立此站點的初衷？',
    a1: '最初架設這個網站，是為了在找實習時能有個地方展示自己的技術棧與開發能力。結果找實習時並沒有真正派上用場，反而是現在的同事偶爾會來看我的網站。',
    q2: '2. 網站的技術棧？',
    a2_pre: '前端採用 ',
    a2_mid1: ' 搭配 ',
    a2_mid2: '（SSG/ISR），以 ',
    a2_mid3: ' 建置、',
    a2_mid4: ' 處理樣式；太空背景使用 ',
    a2_mid5: '（WebGPU/TSL 管線）渲染。後端已全面改寫為 ',
    a2_mid6: '（axum）——Steam、Spotify、WakaTime 與 GitHub 等外部數據也由它串接，資料庫使用 ',
    a2_mid7: '。基礎設施全部透過 ',
    a2_tail: ' 進行容器化部署。',
    q3: '3. 關於照片牆與 AI 的使用？',
    a3: '站內的照片集使用 Masonry 佈局，並透過自動化腳本提取 EXIF 資訊。後續加入了 AI CLIP Tagger 輔助處理標籤，且上傳圖片時會自動產生',
    a3_mid: '作為模糊佔位圖。我會使用 AI 工具協助處理這類瑣碎的自動化流程。詳細可以參考這篇文：',
    q4: '4. 這裡有藏彩蛋嗎？',
    a4: '沒有。沒有實作彩蛋，這裡所見即所得。',
    q5: '5. 這個網站的主要受眾是誰？',
    a5_p1:
      '最初架這個站，單純是把這裡當作我個人求職使用，沒有特別去社群上宣傳。但說實話，既然我都花這麼多時間弄了，當然還是會希望自己花心血熬夜刻出來的畫面與架構能被人看見。',
    a5_p2_pre: '所以，如果你剛好逛到這裡，覺得這個站點的設計或技術棧還合你的胃口，非常歡迎交換友鏈。也歡迎直接在',
    a5_p2_link: '留言',
    a5_p2_post: '留個足跡。',
    nameHeading: '關於命名的由來',
    q6: 'Q: 站點標題「宙と木」是怎麼來的？',
    a6: '沒什麼特別的故事。某天問了 Gemini 一些日文站名候選，看到「宙と木」覺得滿帥的就用了。剛好「宙」（宇宙）跟網站的太空主視覺對得起來，「木」也跟我的網路慣用名「木村盆栽」呼應，就這樣定案了。',
    q7: 'Q: 為什麼叫 Koimsurai？這名字怎麼唸？',
    a7: '這其實是一個組合字。我在網路上的慣用名是「木村盆栽」（Kimura Bonsai），而 Koimsurai 就是從這兩個詞的羅馬拼音中萃取組合而成的專屬 ID。',
    q8: 'Q: 那為什麼當初要叫「木村盆栽」？',
    a8: '剛開始只是因為很喜歡木村拓哉，就隨意借用了這個姓氏，加上「盆栽」覺得唸起來很順口就用了。',
  },
  'zh-CN': {
    intro: '此站点是我用来记录技术与生活的个人网站，从 2025 年 4 月起持续写到现在。',
    qaHeading: '常见问题 Q&A',
    q1: '1. 建立此站点的初衷？',
    a1: '最初架设这个网站，是为了在找实习时能有个地方展示自己的技术栈与开发能力。结果找实习时并没有真正派上用场，反而是现在的同事偶尔会来看我的网站。',
    q2: '2. 网站的技术栈？',
    a2_pre: '前端采用 ',
    a2_mid1: ' 搭配 ',
    a2_mid2: '（SSG/ISR），以 ',
    a2_mid3: ' 构建、',
    a2_mid4: ' 处理样式；太空背景使用 ',
    a2_mid5: '（WebGPU/TSL 管线）渲染。后端已全面改写为 ',
    a2_mid6: '（axum）——Steam、Spotify、WakaTime 与 GitHub 等外部数据也由它串接，数据库使用 ',
    a2_mid7: '。基础设施全部通过 ',
    a2_tail: ' 进行容器化部署。',
    q3: '3. 关于照片墙与 AI 的使用？',
    a3: '站内的照片集使用 Masonry 布局，并透过自动化脚本提取 EXIF 资讯。后续加入了 AI CLIP Tagger 辅助处理标签，且上传图片时会自动产生',
    a3_mid: '作为模糊占位图。我会使用 AI 工具协助处理这类琐碎的自动化流程。详细可以参考这篇文：',
    q4: '4. 这里有藏彩蛋吗？',
    a4: '没有。没有实作彩蛋，这里所见即所得。',
    q5: '5. 这个网站的主要受众是谁？',
    a5_p1:
      '最初架这个站，单纯是把这里当作我个人求职使用，没有特别去社群上宣传。但说实话，既然我都花这么多时间弄了，当然还是会希望自己花心血熬夜刻出来的画面与架构能被人看见。',
    a5_p2_pre: '所以，如果你刚好逛到这里，觉得这个站点的设计或技术栈还合你的胃口，非常欢迎交换友链。也欢迎直接在',
    a5_p2_link: '留言',
    a5_p2_post: '留个足迹。',
    nameHeading: '关于命名的由来',
    q6: 'Q: 站点标题「宙と木」是怎么来的？',
    a6: '没什么特别的故事。某天问了 Gemini 一些日文站名候选，看到「宙と木」觉得满帅的就用了。刚好「宙」（宇宙）跟网站的太空主视觉对得起来，「木」也跟我的网路惯用名「木村盆栽」呼应，就这样定案了。',
    q7: 'Q: 为什么叫 Koimsurai？这名字怎么念？',
    a7: '这其实是一个组合字。我在网路上的惯用名是「木村盆栽」（Kimura Bonsai），而 Koimsurai 就是从这两个词的罗马拼音中萃取组合而成的专属 ID。',
    q8: 'Q: 那为什么当初要叫「木村盆栽」？',
    a8: '刚开始只是因为很喜欢木村拓哉，就随意借用了这个姓氏，加上「盆栽」觉得念起来很顺口就用了。',
  },
  en: {
    intro: 'This site is my personal corner for jotting down tech and life. It has been growing since April 2025.',
    qaHeading: 'FAQ',
    q1: '1. Why did you build this site?',
    a1: "Originally I built it to have a place to show my stack and skills while looking for an internship. It didn't really help with the internship hunt — but my current coworkers do drop by occasionally now.",
    q2: "2. What's the tech stack?",
    a2_pre: 'The frontend uses ',
    a2_mid1: ' with ',
    a2_mid2: ' (SSG/ISR), built with ',
    a2_mid3: ' and styled with ',
    a2_mid4: '. The space backdrop renders with ',
    a2_mid5: ' (WebGPU/TSL). The backend has been fully rewritten in ',
    a2_mid6: ' (axum) — still pulling data from Steam, Spotify, WakaTime, GitHub and friends; data lives in ',
    a2_mid7: '. The whole stack is containerised with ',
    a2_tail: '.',
    q3: '3. About the photo wall and AI usage?',
    a3: 'The photo gallery uses a Masonry layout, with EXIF extracted via automation scripts. I later added an AI CLIP Tagger for tag suggestions, and on upload each image gets a',
    a3_mid:
      'as a blur-sm placeholder. I lean on AI tools for these tedious automation flows. More details in this post:',
    q4: '4. Any easter eggs hidden here?',
    a4: 'Nope. No easter eggs implemented — what you see is what you get.',
    q5: '5. Who is this site for?',
    a5_p1:
      'It started as my personal job-hunt site, with no real promotion on social. Honestly though, after pouring this many late nights into it, I do hope the visuals and architecture get to be seen by someone.',
    a5_p2_pre:
      'So if you happened to wander in and the design or stack feels right, link exchanges are very welcome. Feel free to leave a footprint on the',
    a5_p2_link: 'messages',
    a5_p2_post: 'page too.',
    nameHeading: 'About the name',
    q6: 'Q: Where does the site title 「宙と木」 come from?',
    a6: 'Nothing dramatic. One day I asked Gemini for Japanese site-name candidates, saw 「宙と木」 and thought it looked cool. 「宙」(cosmos) matched the space visuals nicely, and 「木」 echoes my online handle 「木村盆栽」, so I went with it.',
    q7: 'Q: Why "Koimsurai" — how is it pronounced?',
    a7: "It's a compound word. My online handle is 「木村盆栽」 (Kimura Bonsai), and Koimsurai is a custom ID stitched together from the romaji of those two words.",
    q8: 'Q: Why "Kimura Bonsai" originally?',
    a8: 'Just because I was a big Kimura Takuya fan and casually borrowed the surname, then tacked on "bonsai" because it sounded nice.',
  },
  ja: {
    intro: 'このサイトは技術と生活を書き留めるための個人サイトで、2025 年 4 月から今まで続けています。',
    qaHeading: 'よくある質問 Q&A',
    q1: '1. このサイトを作った理由は？',
    a1: '最初はインターンを探すときに自分のスタックと開発スキルを見せる場所が欲しくて作りました。結局インターン探しには役に立ちませんでしたが、今は現職の同僚がたまに覗きにきてくれます。',
    q2: '2. 技術スタックは？',
    a2_pre: 'フロントエンドは ',
    a2_mid1: ' と ',
    a2_mid2: '（SSG/ISR）を採用し、',
    a2_mid3: ' でビルド、',
    a2_mid4: ' でスタイリング。宇宙背景は ',
    a2_mid5: '（WebGPU/TSL）で描画しています。バックエンドは ',
    a2_mid6:
      '（axum）に全面書き換え——Steam・Spotify・WakaTime・GitHub などの外部データもここで取得しています。データベースは ',
    a2_mid7: '、インフラはすべて ',
    a2_tail: ' でコンテナ化されています。',
    q3: '3. 写真ウォールと AI の使い方は？',
    a3: 'サイト内のアルバムは Masonry レイアウトで、EXIF は自動化スクリプトで抽出しています。後から AI CLIP Tagger を追加してタグ付けを補助しており、画像アップロード時には',
    a3_mid:
      'がぼかしのプレースホルダーとして生成されます。こういう細かい自動化には AI を使っています。詳細はこちらの記事で：',
    q4: '4. ここにイースターエッグはありますか？',
    a4: 'ありません。仕込んでいないので、見えているそのままです。',
    q5: '5. このサイトの主な対象は？',
    a5_p1:
      '最初は個人の就活用サイトとして作り、SNS で宣伝もしていません。とはいえこれだけ時間をかけて作ったので、夜なべして作ったデザインや構造を誰かに見てもらえると嬉しいです。',
    a5_p2_pre: 'ですので、たまたま辿りついてデザインや技術スタックが気に入ったら、相互リンク大歓迎です。',
    a5_p2_link: 'メッセージ',
    a5_p2_post: 'ページから足あとを残してくれても嬉しいです。',
    nameHeading: '名前の由来',
    q6: 'Q: サイト名「宙と木」はどこから？',
    a6: '特別な物語はありません。ある日 Gemini に日本語のサイト名候補をいくつか聞いて、「宙と木」がいい感じだったのでそのまま使いました。「宙」（宇宙）はサイトの宇宙系ビジュアルと合うし、「木」はネット上のハンドル「木村盆栽」と呼応するので、そのまま決まりました。',
    q7: 'Q: なぜ Koimsurai？読み方は？',
    a7: 'これは合成語です。ネット上のハンドル名は「木村盆栽」（Kimura Bonsai）で、Koimsurai はその二つのローマ字から抜き出して組み合わせた専用 ID です。',
    q8: 'Q: では最初に「木村盆栽」と名乗ったのは？',
    a8: '木村拓哉が好きだったので苗字を借りて、「盆栽」を付けたら語呂が良かったので使い始めました。',
  },
  ko: {
    intro: '이 사이트는 기술과 일상을 기록하는 개인 웹사이트로, 2025 년 4 월부터 지금까지 계속 써오고 있습니다.',
    qaHeading: '자주 묻는 질문 Q&A',
    q1: '1. 사이트를 만든 이유는?',
    a1: '처음에는 인턴 구할 때 제 스택과 개발 능력을 보여줄 공간이 필요해서 만들었어요. 정작 인턴 찾을 때는 별 도움이 안 됐고, 오히려 지금 동료들이 가끔씩 들러줍니다.',
    q2: '2. 기술 스택은?',
    a2_pre: '프런트엔드는 ',
    a2_mid1: ' 와 ',
    a2_mid2: ' (SSG/ISR)를 사용하고, ',
    a2_mid3: ' 로 빌드, ',
    a2_mid4: ' 로 스타일링합니다. 우주 배경은 ',
    a2_mid5: ' (WebGPU/TSL)로 렌더링합니다. 백엔드는 ',
    a2_mid6:
      ' (axum)로 전면 재작성했으며 — Steam·Spotify·WakaTime·GitHub 같은 외부 데이터도 여기서 가져옵니다. 데이터베이스는 ',
    a2_mid7: ' 를 사용하고, 인프라는 전부 ',
    a2_tail: ' 로 컨테이너화되어 있습니다.',
    q3: '3. 사진 월과 AI 활용은?',
    a3: '사진첩은 Masonry 레이아웃이고, EXIF는 자동화 스크립트로 추출합니다. 이후 AI CLIP Tagger를 추가해 태그 작업을 보조하며, 이미지 업로드 시 자동으로',
    a3_mid:
      '를 흐림 플레이스홀더로 생성합니다. 이런 자질구레한 자동화에는 AI 도구를 적극적으로 사용해요. 자세한 내용은 이 글에서:',
    q4: '4. 이스터에그가 있나요?',
    a4: '없습니다. 이스터에그는 만들지 않았고, 보이는 그대로입니다.',
    q5: '5. 이 사이트의 주된 대상은?',
    a5_p1:
      '원래는 개인 구직용으로 만들었고 따로 SNS에 홍보하지도 않았어요. 하지만 솔직히 이렇게 시간을 들였으니, 밤새워 만든 화면과 구조를 누군가가 봐주면 좋겠다는 마음은 있습니다.',
    a5_p2_pre: '그러니 우연히 들렀다가 디자인이나 스택이 마음에 들면, 상호 링크 환영합니다.',
    a5_p2_link: '메시지',
    a5_p2_post: '페이지에 발자국을 남겨도 좋아요.',
    nameHeading: '이름의 유래',
    q6: 'Q: 사이트 제목 「宙と木」은 어디서 왔어요?',
    a6: '특별한 사연은 없어요. 어느 날 Gemini 에게 일본어 사이트명 후보를 몇 개 받았는데, 「宙と木」이 멋져 보여서 그대로 썼습니다. 「宙」(우주)는 사이트의 우주 비주얼과 맞고, 「木」은 닉네임 「木村盆栽」과 호응해서 자연스럽게 정해졌어요.',
    q7: 'Q: 왜 Koimsurai 인가요? 어떻게 읽어요?',
    a7: '합성어입니다. 온라인 닉네임은 「木村盆栽」(Kimura Bonsai)이고, Koimsurai 는 그 두 단어의 로마자에서 따와 만든 전용 ID 입니다.',
    q8: 'Q: 그럼 왜 처음에 「木村盆栽」이라고 했어요?',
    a8: '키무라 타쿠야를 좋아해서 성씨를 빌리고, 「盆栽」을 붙였더니 발음이 좋아서 그대로 쓰게 됐습니다.',
  },
};

function AboutSite() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  const c = lookupOr(ABOUT_SITE_BY_LANG, lang, ABOUT_SITE_BY_LANG['zh-TW']);

  return (
    <InfoPage
      title={t('info.aboutSite.title')}
      subtitle={t('info.aboutSite.subtitle')}
      slug="about-site"
      prev={null}
      next={{ to: '/history', title: `${t('info.history.title')} — ${t('info.history.subtitle')}` }}
    >
      <p>{c.intro}</p>

      <h2 id="qa">{c.qaHeading}</h2>

      <h3 id="q1">{c.q1}</h3>
      <p>{c.a1}</p>

      <h3 id="q2">{c.q2}</h3>
      <p>
        {c.a2_pre}
        <code>React 19</code>
        {c.a2_mid1}
        <code>TanStack Start</code>
        {c.a2_mid2}
        <code>Vite</code>
        {c.a2_mid3}
        <code>Tailwind CSS</code>
        {c.a2_mid4}
        <code>Three.js</code>
        {c.a2_mid5}
        <code>Rust</code>
        {c.a2_mid6}
        <code>SQLite</code>
        {c.a2_mid7}
        <code>Docker</code>
        {c.a2_tail}
      </p>

      <h3 id="q3">{c.q3}</h3>
      <p>
        {c.a3} <code>thumbhash</code> {c.a3_mid}
      </p>
      <LinkCard href="https://koimsurai.com/blog/21" />

      <h3 id="q4">{c.q4}</h3>
      <p>{c.a4}</p>

      <h3 id="q5">{c.q5}</h3>
      <p>{c.a5_p1}</p>
      <p>
        {c.a5_p2_pre}
        <LocaleLink
          to="/messages"
          style={{
            color: 'rgba(216, 180, 254, 0.95)',
            borderBottom: '1px dashed rgba(216, 180, 254, 0.35)',
            textDecoration: 'none',
          }}
        >
          {c.a5_p2_link}
        </LocaleLink>
        {c.a5_p2_post}
      </p>

      <h2 id="name">{c.nameHeading}</h2>

      <h3 id="q6">{c.q6}</h3>
      <p>{c.a6}</p>

      <h3 id="q7">{c.q7}</h3>
      <p>{c.a7}</p>

      <h3 id="q8">{c.q8}</h3>
      <p>{c.a8}</p>
    </InfoPage>
  );
}

export default AboutSite;
