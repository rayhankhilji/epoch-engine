'use client';

import { CATEGORY_COLOR, simDate, simTime } from '@/lib/api';
import type { WorldEvent } from '@/lib/types';
import { Empty } from './ui';

/**
 * The world's timeline, newest first.
 *
 * Importance drives prominence: a company dying is louder than someone going
 * for a run. The left rule carries the category colour, and the category is
 * also named in text — colour never carries meaning alone.
 */
export function EventFeed({
  events,
  startISO,
  onSelectAgent,
}: {
  events: WorldEvent[];
  startISO: string;
  onSelectAgent?: (agentId: string) => void;
}) {
  if (events.length === 0) {
    return <Empty>Nothing has happened yet. Press play.</Empty>;
  }

  return (
    // overflow-anchor is disabled because events are prepended: with anchoring
    // on, the browser holds the previous content still and the newest event
    // scrolls out of view above the fold.
    <ol className="divide-y divide-hairline [overflow-anchor:none]">
      {events.map((event, index) => {
        const color = CATEGORY_COLOR[event.category] ?? 'var(--color-ink-muted)';
        const major = event.importance >= 0.8;

        return (
          <li
            key={event.id}
            className={`group relative px-4 py-2.5 transition-colors hover:bg-raised/40 ${index === 0 ? 'enter' : ''}`}
          >
            <span className="absolute left-0 top-0 h-full w-0.5" style={{ background: color, opacity: major ? 1 : 0.45 }} />

            <div className="flex items-baseline justify-between gap-3">
              <h3 className={`min-w-0 flex-1 truncate ${major ? 'text-[13px] text-ink' : 'text-xs text-ink-secondary'}`}>
                {event.title}
              </h3>
              <time className="tabular shrink-0 text-[10px] text-ink-faint" title={simDate(startISO, event.t)}>
                {simTime(startISO, event.t)}
              </time>
            </div>

            {event.detail && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">{event.detail}</p>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color }}>
                {event.category}
              </span>
              {event.agentIds.slice(0, 3).map((agentId) => (
                <button
                  key={agentId}
                  type="button"
                  onClick={() => onSelectAgent?.(agentId)}
                  className="text-[10px] text-ink-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-ink-secondary"
                >
                  inspect
                </button>
              ))}
              <span className="text-[10px] text-ink-faint">{simDate(startISO, event.t)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
