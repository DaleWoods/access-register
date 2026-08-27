"use client";

import { useId, useState } from "react";

/**
 * Register posture over time, from the daily snapshots.
 *
 * Three series is deliberate — dormant, unmatched and overdue-review are the
 * three backlogs somebody actually works through. The palette is the first
 * three validated categorical slots (blue / orange / aqua), which clear the
 * colour-vision separation gates as a set. Aqua sits under 3:1 against white,
 * so every series is direct-labelled at its end point and listed in the legend;
 * colour never carries identity on its own here.
 */

export type TrendPoint = {
  day: string;
  dormant: number;
  unmatched: number;
  reviewOverdue: number;
};

const SERIES = [
  { key: "dormant", label: "Dormant", color: "#2a78d6" },
  { key: "unmatched", label: "Unmatched", color: "#eb6834" },
  { key: "reviewOverdue", label: "Overdue review", color: "#1baf7a" },
] as const;

const INK_MUTED = "#898781";
const GRIDLINE = "#e1e0d9";
const SURFACE = "#ffffff";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 132, bottom: 28, left: 40 };

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

/**
 * Clean axis ticks — 0, a midpoint and a rounded top. The top rounds up to
 * 1/2/5 × a power of ten so the midpoint is always a whole number, which
 * matters because these are counts of accounts.
 */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  const top = step * magnitude;
  const mid = top / 2;
  return Number.isInteger(mid) && mid > 0 ? [0, mid, top] : [0, top];
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  // One day of history is a dot, not a trend. Say so rather than drawing a
  // chart that implies more than it knows.
  if (points.length < 2) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-slate-600">Not enough history to chart yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          A snapshot is recorded once a day. This fills in from{" "}
          {points.length === 1 ? "the first one, taken today" : "the first daily run"} — history
          before then cannot be reconstructed.
        </p>
      </div>
    );
  }

  const max = Math.max(
    1,
    ...points.flatMap((p) => [p.dormant, p.unmatched, p.reviewOverdue]),
  );
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  // Positioned by actual date, not by index. Days the job did not run leave a
  // real gap in the line rather than being drawn as if they were one day apart,
  // which would quietly misstate when a change happened.
  const firstDay = dayNumber(points[0].day);
  const lastDay = dayNumber(points[points.length - 1].day);
  const span = Math.max(1, lastDay - firstDay);
  const x = (i: number) => PAD.left + ((dayNumber(points[i].day) - firstDay) / span) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;

  const active = hover === null ? points.length - 1 : hover;

  return (
    <div className="px-5 py-4">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={`Dormant, unmatched and overdue-review accounts over the last ${points.length} daily snapshots`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Recessive hairline grid, with the ticks that carry unlabelled values. */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(tick)}
                y2={y(tick)}
                stroke={GRIDLINE}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill={INK_MUTED}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {tick.toLocaleString()}
              </text>
            </g>
          ))}

          {/* First and last date only — a tick per day would be unreadable. */}
          <text x={PAD.left} y={HEIGHT - 8} fontSize={11} fill={INK_MUTED}>
            {formatDay(points[0].day)}
          </text>
          <text
            x={PAD.left + plotW}
            y={HEIGHT - 8}
            textAnchor="end"
            fontSize={11}
            fill={INK_MUTED}
          >
            {formatDay(points[points.length - 1].day)}
          </text>

          <g clipPath={`url(#${clipId})`}>
            {/* Crosshair for the hovered day. */}
            {hover !== null ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={GRIDLINE}
                strokeWidth={1}
              />
            ) : null}

            {SERIES.map((series) => {
              const d = points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[series.key])}`)
                .join(" ");
              return (
                <path
                  key={series.key}
                  d={d}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {/* End markers, ringed in the surface so overlaps stay legible. */}
            {SERIES.map((series) => (
              <circle
                key={series.key}
                cx={x(active)}
                cy={y(points[active][series.key])}
                r={4}
                fill={series.color}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}
          </g>

          {/* Direct labels at the right edge — the relief for aqua's contrast,
              and the reason this reads without colour-matching to the legend.
              Label and value sit on separate lines so a long name beside a
              four-digit count can never overflow the plot area. */}
          {SERIES.map((series, index) => {
            const blockTop = PAD.top + 10 + index * 36;
            return (
              <g key={series.key}>
                <circle cx={PAD.left + plotW + 16} cy={blockTop - 4} r={4} fill={series.color} />
                <text x={PAD.left + plotW + 26} y={blockTop} fontSize={11} fill="#52514e">
                  {series.label}
                </text>
                <text
                  x={PAD.left + plotW + 26}
                  y={blockTop + 17}
                  fontSize={15}
                  fontWeight={600}
                  fill="#0b0b0b"
                >
                  {points[active][series.key].toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Invisible hit bands — a wider target than the 2px lines. Bounded by
              the midpoints between neighbours, so uneven date spacing still
              gives every point a sensible catchment. */}
          {points.map((point, i) => {
            const left = i === 0 ? PAD.left : (x(i - 1) + x(i)) / 2;
            const right = i === points.length - 1 ? PAD.left + plotW : (x(i) + x(i + 1)) / 2;
            return (
              <rect
                key={point.day}
                x={left}
                y={PAD.top}
                width={Math.max(1, right - left)}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {hover === null
          ? `Latest snapshot: ${formatDay(points[points.length - 1].day)}. Hover to read any day.`
          : `Showing ${formatDay(points[active].day)}.`}
      </p>
    </div>
  );
}
