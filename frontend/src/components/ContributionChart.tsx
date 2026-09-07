import { barPath, niceScale, useElementWidth } from "../lib/chart";
import { compactMoney, money } from "../lib/format";
import { CATEGORY_HUE, type DriverResult } from "../lib/types";

const ROW = 34;
const BAR = 16; // under the 24px cap; the rest of the band is air
const PAD_TOP = 8;
const PAD_BOTTOM = 26;

interface Props {
  drivers: DriverResult[];
}

/**
 * Magnitude comparison across the selected drivers, sorted high to low.
 *
 * Color carries category (identity), length carries value. Every bar is
 * directly labeled: one series colour sits below 3:1 on the light surface, and
 * visible labels plus the table view are the required relief for that.
 */
export function ContributionChart({ drivers }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  if (drivers.length === 0) {
    return <div className="chart-empty">Select a value driver to see the breakdown.</div>;
  }

  const rows = [...drivers].sort((a, b) => b.annualValue - a.annualValue);
  const labelWidth = Math.min(300, Math.max(140, width * 0.38));
  const valueGutter = 62;
  const plotWidth = Math.max(60, width - labelWidth - valueGutter);
  const height = rows.length * ROW + PAD_TOP + PAD_BOTTOM;

  const scale = niceScale(0, Math.max(...rows.map((r) => r.annualValue), 1));
  const ticks = scale.ticks;
  const x = (value: number) => (value / (scale.max || 1)) * plotWidth;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {width > 0 && (
        <svg className="chart" width={width} height={height} role="img"
             aria-label="Annual value contributed by each selected driver">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={labelWidth + x(tick)}
                x2={labelWidth + x(tick)}
                y1={PAD_TOP}
                y2={height - PAD_BOTTOM}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                className="chart__tick"
                x={labelWidth + x(tick)}
                y={height - PAD_BOTTOM + 15}
                textAnchor="middle"
              >
                {compactMoney(tick)}
              </text>
            </g>
          ))}

          {rows.map((row, index) => {
            const y = PAD_TOP + index * ROW;
            const barWidth = Math.max(x(row.annualValue), 2);
            return (
              <g className="chart__row" key={row.driverId}>
                <title>{`${row.name} — ${money(row.annualValue)} / year`}</title>
                <text
                  className="chart__label"
                  x={labelWidth - 12}
                  y={y + ROW / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {truncate(row.name, labelWidth)}
                </text>
                <path
                  className="chart__bar"
                  d={barPath(labelWidth, y + (ROW - BAR) / 2, barWidth, BAR)}
                  fill={CATEGORY_HUE[row.category]}
                />
                <text
                  className="chart__value"
                  x={labelWidth + barWidth + 9}
                  y={y + ROW / 2}
                  dominantBaseline="middle"
                >
                  {compactMoney(row.annualValue)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** SVG will not wrap or ellipsize on its own, and a clipped label is worse than
 * a shortened one. */
function truncate(text: string, available: number): string {
  const limit = Math.max(14, Math.floor((available - 12) / 6.1));
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}
