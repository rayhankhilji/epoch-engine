'use client';

import type { ReactNode } from 'react';

/* ── Surfaces ─────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline bg-surface/70 backdrop-blur-sm ${className}`}
    >
      {title != null && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{title}</h2>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 overflow-auto [overflow-anchor:none] ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/* ── Stat tiles ───────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  detail,
  accent,
  title,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  accent?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-raised/50 px-3 py-2.5" title={title}>
      <div className="flex items-center gap-1.5">
        {accent && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />}
        <div className="truncate text-[10px] uppercase tracking-[0.12em] text-ink-muted">{label}</div>
      </div>
      <div className="mt-1 truncate text-xl leading-tight text-ink">{value}</div>
      {detail != null && <div className="mt-0.5 truncate text-[11px] text-ink-muted">{detail}</div>}
    </div>
  );
}

/* ── Meters ───────────────────────────────────────────────────────────────── */

/**
 * A 0–1 meter. The track is recessive, the fill is thin with a rounded end,
 * and the number sits in ink rather than in the series colour — colour marks
 * identity, text carries the value.
 */
export function Meter({
  label,
  value,
  color = 'var(--color-series-1)',
  invert = false,
}: {
  label: string;
  value: number;
  color?: string;
  invert?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  // Some qualities are bad when high; the meter says so with colour, not words.
  const shade = invert
    ? clamped > 0.7
      ? 'var(--color-critical)'
      : clamped > 0.45
        ? 'var(--color-warning)'
        : color
    : color;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] capitalize text-ink-secondary">{label}</span>
        <span className="tabular text-[11px] text-ink-muted">{Math.round(clamped * 100)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-grid">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${clamped * 100}%`, background: shade }} />
      </div>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────────────── */

/**
 * A 2px line with no axes — a shape, not a chart. Used where the trend matters
 * and the exact values do not.
 */
export function Sparkline({
  values,
  color = 'var(--color-series-1)',
  height = 32,
  label,
}: {
  values: number[];
  color?: string;
  height?: number;
  label: string;
}) {
  if (values.length < 2) {
    return <div className="h-8 rounded bg-raised/40" role="img" aria-label={`${label}: not enough data yet`} />;
  }

  const width = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1]!;
  const gradientId = `spark-${label.replace(/\W/g, '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-8 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${values[0]!.toFixed(2)} to ${values[values.length - 1]!.toFixed(2)}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

/* ── Small pieces ─────────────────────────────────────────────────────────── */

export function Chip({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-raised/60 px-2 py-0.5 text-[10px] text-ink-secondary"
      style={color ? { borderColor: `color-mix(in oklab, ${color} 40%, transparent)` } : undefined}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles = {
    ghost: 'border-hairline bg-raised/60 text-ink-secondary hover:border-ink-faint hover:text-ink',
    primary: 'border-transparent bg-ink text-void hover:bg-ink-secondary',
    danger: 'border-hairline bg-raised/60 text-ink-muted hover:border-critical hover:text-critical',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-xs text-ink-faint">{children}</div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-ink-faint">
      <span className="h-3 w-3 animate-spin rounded-full border border-ink-faint border-t-transparent" />
      {label}
    </div>
  );
}

/** A labelled key/value row — the workhorse of the inspector. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="shrink-0 text-[11px] text-ink-muted">{label}</span>
      <span className="truncate text-right text-xs text-ink-secondary">{children}</span>
    </div>
  );
}
