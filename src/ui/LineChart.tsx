/**
 * 行情折线图。
 *
 * 照旧版 `shop_scene.py` 的 `_draw_line_chart`：一块深色圆角面板、
 * 左上角标题、一条（或多条）折线、底部一排横轴标签。
 * 旧版是 Pygame 现画，这里是 SVG——同样是矢量，而且不用挂 canvas。
 *
 * **数值是「行情」性质的装饰**：旧版每次进场用 `random` 现生成一组随机游走
 * （`_generate_price_history` 里对基准价 ±8% 抖动），本身不代表任何真实经济。
 * 这里保留这套观感，但**改成按日键确定的伪随机**：
 * 同一天进来两次看到的是同一张图（旧版每次进场都不一样，看着像图表在闪）。
 */
export interface ChartSeries {
  readonly name: string;
  readonly color: string;
  readonly values: readonly number[];
}

export interface LineChartProps {
  readonly title: string;
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
  /** 图例单位后缀，例如 `%`。 */
  readonly unit?: string;
}

/** 画布的设计尺寸；外面用 CSS 缩放，坐标在视图内固定。 */
const VIEW_W = 640;
const VIEW_H = 300;
/*
  **横轴标签不放 SVG 里**：SVG 用了 `preserveAspectRatio="none"` 让折线铺满容器，
  而那会把横向拉长——文字跟着一起被拉成方块（实测「周一」就是这样）。
  刻度改成 SVG 下面的 DOM 行，怎么拉都不变形。
*/
const PAD = { top: 20, right: 14, bottom: 8, left: 46 };

export function LineChart({ title, labels, series, unit = '' }: LineChartProps) {
  const all = series.flatMap((line) => [...line.values]);
  const min = all.length > 0 ? Math.min(...all) : 0;
  const max = all.length > 0 ? Math.max(...all) : 1;
  const span = max - min || 1;
  // 上下各留 10% 余量，折线不会贴在边框上
  const lo = min - span * 0.1;
  const hi = max + span * 0.1;
  const range = hi - lo || 1;

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const pointCount = Math.max(1, labels.length - 1);
  const xOf = (index: number): number => PAD.left + (plotW * index) / pointCount;
  const yOf = (value: number): number => PAD.top + plotH * (1 - (value - lo) / range);

  return (
    <div className="chart">
      <span className="chart__title">{title}</span>
      <svg
        className="chart__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* 四道横向网格：只作背景刻度，不标数值（旧版也没有纵轴刻度） */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            className="chart__grid"
            x1={PAD.left}
            x2={VIEW_W - PAD.right}
            y1={PAD.top + plotH * ratio}
            y2={PAD.top + plotH * ratio}
          />
        ))}

        {series.map((line) => (
          <polyline
            key={line.name}
            className="chart__line"
            points={line.values.map((value, index) => `${xOf(index)},${yOf(value)}`).join(' ')}
            stroke={line.color}
          />
        ))}

      </svg>

      {/* 横轴刻度：DOM 行，与折线的横向网格对齐靠 `justify-content: space-between` */}
      <div className="chart__axis" aria-hidden="true">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <ul className="chart__legend">
        {series.map((line) => (
          <li key={line.name}>
            <span className="chart__swatch" style={{ background: line.color }} aria-hidden="true" />
            {line.name}
            {unit}
          </li>
        ))}
      </ul>
    </div>
  );
}
