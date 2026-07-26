'use client';

import { useState } from 'react';
import { money } from '@/lib/api';
import type { WealthData } from '@/lib/types';
import { Empty } from './ui';

/**
 * Wealth distribution.
 *
 * One series, so no legend — the panel title names it. Bars are thin with a
 * 4px rounded top anchored to the baseline, separated by a 2px surface gap,
 * and every bar has a hover tooltip because an HTML chart that can be
 * interactive should be.
 */
export function WealthChart({ data }: { data: WealthData }) {
  const [hover, setHover] = useState<number | null>(null);

  const populated = data.buckets.filter((b) => b.count > 0);
  if (populated.length === 0) return <Empty>No wealth data yet.</Empty>;

  const max = Math.max(...data.buckets.map((b) => b.count));
  const width = 320;
  const height = 120;
  const gap = 2;
  const barWidth = Math.max(2, width / data.buckets.length - gap);

  return (
    <div className="px-4 pb-3 pt-2">
      <div className="mb-3 flex items-baseline gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">Gini</div>
          <div className="tabular text-lg leading-tight text-ink">{data.gini.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">Median</div>
          <div className="tabular text-lg leading-tight text-ink">{money(data.median)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-muted">Total</div>
          <div className="tabular text-lg leading-tight text-ink">{money(data.total)}</div>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Wealth distribution histogram">
          {/* Recessive gridlines — present, never competing with the data. */}
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={width}
              y1={height - fraction * (height - 8)}
              y2={height - fraction * (height - 8)}
              stroke="var(--color-grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {data.buckets.map((bucket, index) => {
            const barHeight = max === 0 ? 0 : (bucket.count / max) * (height - 8);
            const x = index * (barWidth + gap);
            const negative = bucket.to <= 0;

            return (
              <g key={index} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
                {/* An invisible full-height target, so the hover area is much
                    bigger than a one-pixel bar. */}
                <rect x={x} y={0} width={barWidth + gap} height={height} fill="transparent" />
                {bucket.count > 0 && (
                  <rect
                    x={x}
                    y={height - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx="2"
                    fill={negative ? 'var(--color-critical)' : 'var(--color-series-1)'}
                    opacity={hover == null || hover === index ? 1 : 0.45}
                    className="transition-opacity"
                  />
                )}
              </g>
            );
          })}

          <line x1="0" x2={width} y1={height} y2={height} stroke="var(--color-baseline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>

        {hover != null && data.buckets[hover] && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-md border border-hairline bg-raised px-2 py-1.5 text-[11px] shadow-lg"
            style={{ left: `${((hover + 0.5) / data.buckets.length) * 100}%`, transform: 'translate(-50%, -100%)' }}
          >
            <div className="tabular text-ink">{data.buckets[hover]!.count} people</div>
            <div className="tabular whitespace-nowrap text-ink-muted">
              {money(data.buckets[hover]!.from)} – {money(data.buckets[hover]!.to)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span className="tabular">{money(data.buckets[0]?.from ?? 0)}</span>
        <span>net worth</span>
        <span className="tabular">{money(data.buckets[data.buckets.length - 1]?.to ?? 0)}</span>
      </div>
    </div>
  );
}
