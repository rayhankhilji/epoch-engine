/**
 * News.
 *
 *   Hacker News (via the Algolia index) — technology and startups
 *   GDELT                              — world news, any topic, any language
 *
 * Both are free and keyless. Stories are tagged with topics so `@epoch/core`
 * can route a story to the agents who would plausibly care about it: the
 * founder in Lagos hears about a funding round, the biologist doesn't.
 */

import type { NewsItem } from '@epoch/core';
import { fetchJson } from './http.ts';

const HN_FRONT_PAGE = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';
const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

interface AlgoliaResponse {
  hits: Array<{
    objectID: string;
    title?: string | null;
    story_title?: string | null;
    url?: string | null;
    created_at?: string;
    points?: number;
    _tags?: string[];
  }>;
}

export async function fetchHackerNews(): Promise<NewsItem[]> {
  const payload = await fetchJson<AlgoliaResponse>(HN_FRONT_PAGE, { ttlMs: 30 * 60_000 });

  return payload.hits.flatMap((hit) => {
    const title = hit.title ?? hit.story_title;
    if (!title) return [];
    return [
      {
        id: `hn:${hit.objectID}`,
        title,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'Hacker News',
        publishedAt: hit.created_at ? Date.parse(hit.created_at) : Date.now(),
        topics: inferTopics(title),
      },
    ];
  });
}

interface GdeltResponse {
  articles?: Array<{
    url?: string;
    title?: string;
    domain?: string;
    seendate?: string;
  }>;
}

/**
 * World news matching a query. GDELT indexes global coverage, so this is what
 * makes an agent in Nairobi aware of something happening in Nairobi.
 */
export async function fetchGdelt(query: string, limit = 15): Promise<NewsItem[]> {
  const url =
    `${GDELT}?query=${encodeURIComponent(query)}` +
    `&mode=artlist&format=json&maxrecords=${limit}&sort=datedesc`;

  // GDELT rate-limits hard and answers 429 rather than queueing, so this holds
  // results for longer and does not retry — a retry just burns the next slot.
  const payload = await fetchJson<GdeltResponse>(url, { ttlMs: 2 * 60 * 60_000, retries: 0 });

  return (payload.articles ?? []).flatMap((article) => {
    if (!article.title || !article.url) return [];
    return [
      {
        id: `gdelt:${hash(article.url)}`,
        title: article.title,
        url: article.url,
        source: article.domain ?? 'GDELT',
        publishedAt: parseGdeltDate(article.seendate),
        topics: inferTopics(article.title),
      },
    ];
  });
}

/**
 * The world's news for a tick: technology from Hacker News, plus a GDELT sweep
 * for whatever the population actually cares about.
 */
export async function fetchNews(
  topics: string[] = [],
  onWarning?: (message: string, detail?: unknown) => void,
): Promise<NewsItem[]> {
  const query = topics.length > 0 ? topics.slice(0, 4).join(' OR ') : 'economy OR technology';

  const [hn, world] = await Promise.allSettled([fetchHackerNews(), fetchGdelt(query)]);

  const items: NewsItem[] = [];
  if (hn.status === 'fulfilled') items.push(...hn.value);
  else onWarning?.('Hacker News unavailable', hn.reason);

  if (world.status === 'fulfilled') items.push(...world.value);
  else onWarning?.('GDELT unavailable', world.reason);

  // Newest first, de-duplicated by headline.
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ['artificial intelligence', /\b(ai|artificial intelligence|llm|machine learning|neural|openai|anthropic|gpt|model)\b/i],
  ['startups', /\b(startup|founder|seed round|series [a-e]|yc|y combinator|raises?|funding|vc)\b/i],
  ['crypto', /\b(bitcoin|ethereum|crypto|blockchain|defi|stablecoin|token)\b/i],
  ['politics', /\b(election|president|parliament|senate|minister|congress|vote|policy|government)\b/i],
  ['climate', /\b(climate|carbon|emissions|renewable|solar|wind farm|warming|drought|flood)\b/i],
  ['space', /\b(nasa|spacex|rocket|orbit|mars|satellite|launch|lunar)\b/i],
  ['biotech', /\b(gene|crispr|vaccine|clinical trial|biotech|protein|drug|fda)\b/i],
  ['finance', /\b(market|stocks?|inflation|interest rate|fed|bank|recession|gdp|bond)\b/i],
  ['health', /\b(health|hospital|disease|outbreak|mental health|cancer|patients?)\b/i],
  ['technology', /\b(software|chip|semiconductor|apple|google|microsoft|linux|open source|security|breach)\b/i],
];

export function inferTopics(title: string): string[] {
  const topics = TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(title)).map(([topic]) => topic);
  return topics.length > 0 ? topics : ['world'];
}

/** GDELT stamps dates as YYYYMMDDTHHMMSSZ. */
function parseGdeltDate(value?: string): number {
  if (!value) return Date.now();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  const [, y, mo, d, h, mi, s] = match;
  return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
}

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
