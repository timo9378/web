// 互動圖表：讀者拉滑桿改各項數值 → recharts 即時重繪。重用 ChartBlock（同一 lazy chunk）。
import { useState } from 'react';
import ChartBlock from './ChartBlock';

interface Row {
  label: string;
  value: number;
  // index signature → 與 ChartBlock 的 data 型別相容
  [k: string]: string | number;
}
interface Props {
  /** 互動最適合單序列的 bar/line/area。 */
  type?: 'bar' | 'line' | 'area';
  data?: { label?: string; value?: number }[];
  title?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export default function InteractiveChartBlock({
  type = 'bar',
  data = [],
  title,
  unit,
  min = 0,
  max,
  step = 1,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    data.map((d) => ({ label: String(d.label ?? ''), value: Number(d.value) || 0 })),
  );

  if (!data.length) {
    return <div className="mdx-chart-empty">（InteractiveChart：無資料 / data 格式錯誤）</div>;
  }

  const hi = max ?? Math.max(...rows.map((r) => r.value), 1) * 2;
  const setAt = (i: number, v: number) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: v } : r)));

  return (
    <div className="mdx-chart-interactive">
      <ChartBlock
        type={type}
        data={rows}
        series={['value']}
        categoryKey="label"
        unit={unit}
        title={title}
        height={260}
      />
      <div className="mdx-chart-sliders">
        {rows.map((r, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <label key={r.label || i} className="mdx-chart-slider">
            <span className="mdx-chart-slider-label">{r.label}</span>
            <input
              type="range"
              min={min}
              max={hi}
              step={step}
              value={r.value}
              onChange={(e) => setAt(i, Number(e.target.value))}
            />
            <span className="mdx-chart-slider-value">
              {r.value}
              {unit ? ` ${unit}` : ''}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
