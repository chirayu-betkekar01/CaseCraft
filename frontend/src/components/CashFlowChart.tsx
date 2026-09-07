import { niceScale, useElementWidth } from "../lib/chart";
import { compactMoney, money } from "../lib/format";

const HEIGHT = 232;
const PAD = { top: 14, right: 14, bottom: 26, left: 52 };

interface Props {
  points: { month: number; net: number }[];
  paybackMonths: number | null;
  termYears: number;
}

/**
 * Cumulative net position over the term, against a zero baseline.
 *
 * One series, so no legend — the card title says what is plotted. The payback
 * crossing is the single point worth direct-labeling.
 */
export function CashFlowChart({ points, paybackMonths, termYears }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  if (points.length === 0) {
    return <div className="chart-empty">No cash flow to plot yet.</div>;
  }

  const plotWidth = Math.max(60, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const maxMonth = points[points.length - 1]?.month ?? termYears * 12;
  const values = points.map((p) => p.net);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const span = scale.max - scale.min || 1;

  const x = (month: number) => PAD.left + (month / maxMonth) * plotWidth;
  const y = (value: number) => PAD.top + ((scale.max - value) / span) * plotHeight;

  const ticks = scale.ticks;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.month)},${y(p.net)}`).join(" ");
  const area = `${line} L${x(maxMonth)},${y(0)} L${x(0)},${y(0)} Z`;
  const monthTicks = Array.from({ length: termYears + 1 }, (_, i) => i * 12);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {width > 0 && (
        <svg className="chart" width={width} height={HEIGHT} role="img"
             aria-label="Cumulative net position across the term">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left} x2={PAD.left + plotWidth}
                y1={y(tick)} y2={y(tick)}
                stroke="var(--grid)" strokeWidth={1}
              />
              <text className="chart__tick" x={PAD.left - 9} y={y(tick)}
                    textAnchor="end" dominantBaseline="middle">
                {compactMoney(tick)}
              </text>
            </g>
          ))}

          {monthTicks.map((month) => (
            <text key={month} className="chart__tick" x={x(month)} y={HEIGHT - 8}
                  textAnchor="middle">
              {month}
            </text>
          ))}

          <path d={area} fill="var(--accent)" opacity={0.1} />

          {/* Zero baseline: solid hairline, one step off the surface. */}
          <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(0)} y2={y(0)}
                stroke="var(--baseline)" strokeWidth={1} />

          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />

          {paybackMonths !== null && paybackMonths > 0 && paybackMonths <= maxMonth && (
            <g>
              <circle cx={x(paybackMonths)} cy={y(0)} r={5}
                      fill="var(--good)" stroke="var(--surface-1)" strokeWidth={2} />
              <text className="chart__value" x={x(paybackMonths) + 11} y={y(0) - 10}>
                Payback · {paybackMonths.toFixed(1)} mo
              </text>
            </g>
          )}

          {points
            .filter((p) => p.month % 12 === 0)
            .map((p) => (
              <g key={p.month}>
                <title>{`Month ${p.month} — ${money(p.net)}`}</title>
                <circle cx={x(p.month)} cy={y(p.net)} r={9} fill="transparent" />
              </g>
            ))}

          <text className="chart__tick" x={PAD.left + plotWidth / 2} y={HEIGHT - 8}
                textAnchor="middle" opacity={0}>
            Months
          </text>
        </svg>
      )}
    </div>
  );
}
