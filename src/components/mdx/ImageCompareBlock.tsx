// MDX <ImageCompare before="/uploads/a.png" after="/uploads/b.png" />：前後圖對比滑桿。
// 用現成 react-compare-slider（拖曳分隔線比較兩張圖）。client-only（碰 pointer/ResizeObserver）→
// 由 mdx-blocks 以 ClientOnly + lazy 掛載。
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';

interface Props {
  before?: string;
  after?: string;
  beforeLabel?: string;
  afterLabel?: string;
  alt?: string;
  caption?: string;
}

export default function ImageCompareBlock({
  before,
  after,
  beforeLabel = '前',
  afterLabel = '後',
  alt = '',
  caption,
}: Props) {
  if (!before || !after) return null;
  return (
    <figure className="mdx-imgcompare">
      <div className="mdx-imgcompare-frame">
        <ReactCompareSlider
          className="mdx-imgcompare-slider"
          itemOne={<ReactCompareSliderImage src={before} alt={alt ? `${alt}（${beforeLabel}）` : beforeLabel} />}
          itemTwo={<ReactCompareSliderImage src={after} alt={alt ? `${alt}（${afterLabel}）` : afterLabel} />}
        />
        <span className="mdx-imgcompare-badge mdx-imgcompare-badge--before" aria-hidden>{beforeLabel}</span>
        <span className="mdx-imgcompare-badge mdx-imgcompare-badge--after" aria-hidden>{afterLabel}</span>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
