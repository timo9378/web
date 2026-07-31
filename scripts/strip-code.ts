/**
 * 把 markdown/MDX 裡的程式碼拿掉（圍欄 + 行內）。
 *
 * 兩支內容檢查都需要它，而且都是因為**同一個教訓**：不先去掉程式碼，掃出來的東西
 * 幾乎全是誤報，而一個誤報多的檢查很快就會被當成噪音忽略。
 *
 *   check-mdx.ts   文章 #33 的 `ChatTransport<UIMessage>` 被當成「用到沒註冊的
 *                  block UIMessage」
 *   check-links.ts 程式碼範例裡的 `https://p2.bahamut.com.tw/B/ACG/c/{animeSn}`、
 *                  `https://$DOMAIN`、`http://minio:9000` 被當成死連結
 *                  （實測 8 個「壞連結」裡有 6 個是這種）
 *
 * 抽成共用而不是各抄一份：抄的那份會在有人補規則時悄悄過時。
 */
export function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '') // 圍欄程式碼
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, ''); // 行內程式碼
}
