import { useEffect, useRef, useState } from "react";

/** Measures a container so SVG text renders at its true size rather than being
 * scaled by a viewBox (which would make labels grow on wide screens). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * An axis rounded to clean numbers that always contains the data.
 *
 * One step is chosen across the whole span, then the bounds are widened out to
 * it. Deriving the positive and negative halves separately is what produces
 * both classic failures: a domain that ends below the data (so the line draws
 * outside the plot) and a cluster of collided labels where a short negative
 * arm gets the same tick count as a long positive one.
 */
export function niceScale(min: number, max: number, target = 5): Scale {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo || 1;

  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;

  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  const count = Math.round((niceMax - niceMin) / step);
  for (let i = 0; i <= count; i += 1) {
    const value = niceMin + i * step;
    // Re-round to kill floating point dust like 0.30000000000000004.
    ticks.push(Number(value.toPrecision(12)));
  }

  return { min: niceMin, max: niceMax, ticks };
}

/**
 * A bar with its data-end rounded and its baseline end square.
 *
 * A plain `rx` would round all four corners, which detaches the bar from the
 * axis it grows from.
 */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width, height / 2));
  if (r === 0) return `M${x},${y}h${width}v${height}h${-width}Z`;
  return [
    `M${x},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height - r}`,
    `A${r},${r} 0 0 1 ${x + width - r},${y + height}`,
    `H${x}`,
    "Z",
  ].join(" ");
}
