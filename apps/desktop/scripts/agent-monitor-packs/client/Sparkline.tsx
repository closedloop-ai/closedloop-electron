/**
 * @file Sparkline.tsx — pure inline SVG sparkline (no chart deps).
 * Renders an 80x20 px polyline of values normalized to fit. Returns
 * null when there are fewer than 2 data points.
 */
import { useMemo } from "react";

interface SparklineProps {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  stroke?: string;
}

export function Sparkline({
  values,
  width = 80,
  height = 20,
  stroke = "currentColor",
}: SparklineProps) {
  const points = useMemo(() => {
    const clean = values
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      .filter((v): v is number => v !== null);
    if (clean.length < 2) return null;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const step = width / (clean.length - 1);
    return clean
      .map((v, i) => {
        const x = i * step;
        const y = height - ((v - min) / range) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, width, height]);

  if (!points) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
