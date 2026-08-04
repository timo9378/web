// 統一圖表 block（recharts）：type = line / area / bar / pie / donut / scatter / radar。
// 重（recharts）→ 由 mdx-blocks 以 lazy + ClientOnly 載入。色盤用 dataviz 驗證過的分類色盤（暗色欄）。
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

// dataviz 分類色盤（暗色欄）——順序即色盲安全機制，勿隨意重排。
const SERIES_COLORS = [
  '#3987e5', // blue
  '#008300', // green
  '#d55181', // magenta
  '#c98500', // yellow
  '#199e70', // aqua
  '#d95926', // orange
  '#9085e9', // violet
  '#e66767', // red
];
const GRID = '#2c2c2a';
const AXIS = 'rgba(255,255,255,0.45)';

export type ChartType = 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'scatter' | 'radar';

type Row = Record<string, string | number | undefined>;
interface SeriesDef {
  key: string;
  name?: string;
  color?: string;
}

export interface ChartBlockProps {
  type?: ChartType;
  data?: Row[];
  /** 要畫的序列（key = data 裡的欄位）。省略時自動抓數值欄位。 */
  series?: (string | SeriesDef)[];
  /** 類別軸 / x 軸 / pie 標籤 的欄位名，預設 'label'。 */
  categoryKey?: string;
  title?: string;
  unit?: string;
  /** area/bar 是否堆疊。 */
  stacked?: boolean;
  /** scatter 用：x/y（+ 可選 z 泡泡大小）欄位名。 */
  xKey?: string;
  yKey?: string;
  zKey?: string;
  height?: number;
}

const norm = (s: (string | SeriesDef)[] | undefined, data: Row[], catKey: string): SeriesDef[] => {
  if (s?.length) return s.map((x) => (typeof x === 'string' ? { key: x } : x));
  // 自動：第一列裡除 catKey 外的數值欄位
  const first = data[0] ?? {};
  return Object.keys(first)
    .filter((k) => k !== catKey && typeof first[k] === 'number')
    .map((k) => ({ key: k }));
};

function ChartTip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="mdx-chart-tip">
      {label != null ? <div className="mdx-chart-tip-label">{label}</div> : null}
      {payload.map((p, i) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key
        <div key={i} className="mdx-chart-tip-row">
          <span className="mdx-chart-tip-swatch" style={{ background: p.color }} />
          <span className="mdx-chart-tip-name">{p.name ?? p.dataKey}</span>
          <span className="mdx-chart-tip-value">
            {p.value}
            {unit ? ` ${unit}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ChartBlock(props: ChartBlockProps) {
  const {
    type = 'bar',
    data = [],
    categoryKey = 'label',
    title,
    unit,
    stacked = false,
    xKey = 'x',
    yKey = 'y',
    zKey,
    height = 300,
  } = props;

  const seriesDefs = useMemo(() => norm(props.series, data, categoryKey), [props.series, data, categoryKey]);
  const color = (i: number, def?: SeriesDef) => def?.color ?? SERIES_COLORS[i % SERIES_COLORS.length];

  if (!data.length) {
    return <div className="mdx-chart-empty">（Chart：無資料 / data 格式錯誤）</div>;
  }

  const axisProps = {
    tick: { fill: AXIS, fontSize: 12 },
    tickLine: false,
    axisLine: { stroke: GRID },
  };

  const chart = () => {
    switch (type) {
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={categoryKey} {...axisProps} />
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: GRID }} />
            {seriesDefs.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {seriesDefs.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name ?? s.key}
                stroke={color(i, s)}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: color(i, s) }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <defs>
              {seriesDefs.map((s, i) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color(i, s)} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color(i, s)} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={categoryKey} {...axisProps} />
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: GRID }} />
            {seriesDefs.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {seriesDefs.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name ?? s.key}
                stackId={stacked ? '1' : undefined}
                stroke={color(i, s)}
                strokeWidth={2}
                fill={`url(#grad-${s.key})`}
              />
            ))}
          </AreaChart>
        );
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={categoryKey} {...axisProps} />
            <YAxis {...axisProps} width={44} />
            <Tooltip content={<ChartTip unit={unit} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            {seriesDefs.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {seriesDefs.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name ?? s.key}
                stackId={stacked ? '1' : undefined}
                fill={color(i, s)}
                radius={stacked ? 0 : [4, 4, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        );
      case 'pie':
      case 'donut': {
        const valueKey = seriesDefs[0]?.key ?? 'value';
        return (
          <PieChart>
            <Tooltip content={<ChartTip unit={unit} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={categoryKey}
              cx="50%"
              cy="50%"
              innerRadius={type === 'donut' ? '55%' : 0}
              outerRadius="80%"
              paddingAngle={2}
              stroke="#12121a"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      }
      case 'scatter':
        return (
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis type="number" dataKey={xKey} name={xKey} {...axisProps} />
            <YAxis type="number" dataKey={yKey} name={yKey} {...axisProps} width={44} />
            {zKey ? <ZAxis type="number" dataKey={zKey} range={[40, 400]} /> : null}
            <Tooltip content={<ChartTip unit={unit} />} cursor={{ strokeDasharray: '3 3', stroke: GRID }} />
            <Scatter data={data} fill={SERIES_COLORS[0]} fillOpacity={0.8} />
          </ScatterChart>
        );
      case 'radar':
        return (
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke={GRID} />
            <PolarAngleAxis dataKey={categoryKey} tick={{ fill: AXIS, fontSize: 12 }} />
            <PolarRadiusAxis tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} />
            <Tooltip content={<ChartTip unit={unit} />} />
            {seriesDefs.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {seriesDefs.map((s, i) => (
              <Radar
                key={s.key}
                dataKey={s.key}
                name={s.name ?? s.key}
                stroke={color(i, s)}
                fill={color(i, s)}
                fillOpacity={0.18}
                strokeWidth={2}
              />
            ))}
          </RadarChart>
        );
      default:
        return <div className="mdx-chart-empty">（Chart：未知 type「{type}」）</div>;
    }
  };

  return (
    <figure className="mdx-chart">
      {title ? <figcaption className="mdx-chart-title">{title}</figcaption> : null}
      <ResponsiveContainer width="100%" height={height}>
        {chart()}
      </ResponsiveContainer>
    </figure>
  );
}
