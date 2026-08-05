import { describe, expect, it } from 'vitest';
import { parseMermaidFrontmatter } from './mermaidFrontmatter';

// 這支的失敗模式是「設定安靜地被忽略」：圖照樣畫得出來，只是主題／版面跟寫的不一樣。
// 沒有任何東西會報錯，所以它需要測試多過需要 try/catch。

describe('parseMermaidFrontmatter', () => {
  it('沒有 frontmatter 就原樣回傳，config 是空物件而不是 null', () => {
    const r = parseMermaidFrontmatter('graph TD; A --> B');
    expect(r).toEqual({ config: {}, body: 'graph TD; A --> B' });
  });

  it('前後多餘的空白會被修掉', () => {
    expect(parseMermaidFrontmatter('\n\n  graph TD; A --> B  \n\n').body).toBe('graph TD; A --> B');
  });

  it('拆出頂層的 key: value，本文不含 frontmatter', () => {
    const r = parseMermaidFrontmatter('---\ntitle: 流程圖\n---\ngraph TD; A --> B');
    expect(r.config).toEqual({ title: '流程圖' });
    expect(r.body).toBe('graph TD; A --> B');
  });

  it('巢狀一層：值留空的 key 底下縮排的都算它的', () => {
    const r = parseMermaidFrontmatter('---\nconfig:\n    theme: dark\n    look: handDrawn\n---\ngraph TD; A --> B');
    expect(r.config).toEqual({ config: { theme: 'dark', look: 'handDrawn' } });
  });

  // mermaid 文件裡兩種縮排都出現過，所以兩種都要當成頂層
  it('頂層的縮排 0 與 2 都認', () => {
    expect(parseMermaidFrontmatter('---\ntitle: A\n---\nx').config).toEqual({ title: 'A' });
    expect(parseMermaidFrontmatter('---\n  title: A\n---\nx').config).toEqual({ title: 'A' });
  });

  it('同時有頂層純值與巢狀區塊', () => {
    const r = parseMermaidFrontmatter('---\ntitle: 流程圖\nconfig:\n    theme: dark\n---\ngraph TD');
    expect(r.config).toEqual({ title: '流程圖', config: { theme: 'dark' } });
  });

  it('註解行與空行跳過', () => {
    const r = parseMermaidFrontmatter('---\n# 這是註解\n\ntitle: A\n---\nx');
    expect(r.config).toEqual({ title: 'A' });
  });

  it('巢狀區塊之後又出現頂層純值，會結束巢狀', () => {
    const r = parseMermaidFrontmatter('---\nconfig:\n    theme: dark\ntitle: 之後的\n---\nx');
    expect(r.config).toEqual({ config: { theme: 'dark' }, title: '之後的' });
  });

  it('key 允許連字號（mermaid 的設定有這種）', () => {
    expect(parseMermaidFrontmatter('---\nsome-key: v\n---\nx').config).toEqual({ 'some-key': 'v' });
  });

  it('不是 key: value 的行直接忽略，不會壞掉', () => {
    const r = parseMermaidFrontmatter('---\ntitle: A\n這行不是設定\n---\nx');
    expect(r.config).toEqual({ title: 'A' });
    expect(r.body).toBe('x');
  });

  it('只有開頭的 --- 沒有收尾就不算 frontmatter（整段都是本文）', () => {
    const src = '---\ntitle: A\ngraph TD; A --> B';
    expect(parseMermaidFrontmatter(src)).toEqual({ config: {}, body: src });
  });

  it('`---` 不在開頭就不算（圖裡本來就可能有虛線）', () => {
    const src = 'graph TD; A --> B\n---\ntitle: A\n---';
    expect(parseMermaidFrontmatter(src).config).toEqual({});
  });

  it('空的 frontmatter 不會炸', () => {
    const r = parseMermaidFrontmatter('---\n\n---\ngraph TD');
    expect(r.config).toEqual({});
    expect(r.body).toBe('graph TD');
  });
});
