// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import KoimLoader from '@/components/common/KoimLoader';
import Comments from '@/components/blog/Comments';

// 外殼本身要有測試：它壞掉的話**每一支元件測試**都會紅，而錯誤訊息長得像元件的問題
// （「找不到那個 selector」「Cannot read properties of undefined」）。
// 有這兩條在，第一時間就分得出是外殼還是被測元件。
describe('provider 外殼', () => {
  it('掛得起簡單元件', async () => {
    const r = await renderWithProviders(<KoimLoader text="測試" />);
    expect(r.container.querySelector('.koim-loader')).toBeTruthy();
  });

  it('掛得起需要 auth / query / i18n 的元件', async () => {
    const r = await renderWithProviders(<Comments postId={1} />);
    expect(r.container.querySelector('.comments-block')).toBeTruthy();
  });
});
