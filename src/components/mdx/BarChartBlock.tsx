// MDX <BarChart> 的 recharts 實作。獨立檔 → 由 mdx-blocks 以 lazy import 載入，
// recharts（重）只在文章真的用到圖表時才進 bundle。
//
// 設計（依 dataviz 準則）：benchmark 對比 = 量值比較 → 單一色調（不是每根不同色，
// 那會暗示顏色有意義）；識別靠 x 軸標籤；直接數值標籤 + hover tooltip；細長條、圓角頂、
// 收斂的格線/軸。暗色主題。
import {
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Datum {
  label: string;
  value: number;
}
interface BarChartBlockProps {
  data?: Datum[];
  title?: string;
  unit?: string;
  color?: string;
}

const ACCENT = '#8b7cf6';

interface TipProps {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  unit?: string;
}
function ChartTooltip({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div className="mdx-chart-tip">
      <div className="mdx-chart-tip-label">{label}</div>
      <div className="mdx-chart-tip-value">
        {v}
        {unit ? ` ${unit}` : ''}
      </div>
    </div>
  );
}

export default function BarChartBlock({ data = [], title, unit, color = ACCENT }: BarChartBlockProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="mdx-chart-empty">（BarChart：無資料 / data 格式錯誤）</div>;
  }
  const fmt = (v: unknown): string => {
    const s = typeof v === 'number' || typeof v === 'string' ? String(v) : '';
    return `${s}${unit ? ` ${unit}` : ''}`;
  };
  return (
    <figure className="mdx-chart">
      {title ? <figcaption className="mdx-chart-title">{title}</figcaption> : null}
      <ResponsiveContainer width="100%" height={280}>
        <ReBarChart data={data} margin={{ top: 26, right: 8, bottom: 4, left: 8 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip unit={unit} />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64} fill={color} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="top"
              fill="rgba(255,255,255,0.75)"
              fontSize={12}
              formatter={fmt}
            />
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </figure>
  );
}
