/**
 * @epoch/world — live reality.
 *
 * Implements the `WorldDataSource` hook that `@epoch/core` calls once per
 * simulated day. Every source is free and keyless, and every one of them is
 * allowed to fail: if the network is down, or you are on a plane, the world
 * keeps running on its own internal economy.
 */

import type { City, NewsItem, Quote, Weather } from '@epoch/core';
import type { WorldDataSource } from '@epoch/core';
import { fetchWeather } from './weather.ts';
import { fetchMarket } from './markets.ts';
import { fetchNews } from './news.ts';
import { tolerate } from './http.ts';

export * from './http.ts';
export * from './weather.ts';
export * from './markets.ts';
export * from './news.ts';
export * from './geo.ts';

export interface WorldDataOptions {
  /** Turn individual sources off — useful for offline development. */
  weather?: boolean;
  markets?: boolean;
  news?: boolean;
  onWarning?: (message: string, detail?: unknown) => void;
}

/**
 * The data source you hand to `new Simulation({ data })`.
 *
 * ```ts
 * const sim = new Simulation({ world, mind, data: createWorldData() });
 * ```
 */
export function createWorldData(options: WorldDataOptions = {}): WorldDataSource {
  const warn = options.onWarning;
  const enabled = {
    weather: options.weather ?? true,
    markets: options.markets ?? true,
    news: options.news ?? true,
  };

  return {
    async fetchWeather(cities: City[]): Promise<Weather[]> {
      if (!enabled.weather) return [];
      return tolerate('Open-Meteo', () => fetchWeather(cities), [], warn);
    },

    async fetchMarket(): Promise<{ quotes: Record<string, Quote>; fx: Record<string, number> }> {
      if (!enabled.markets) return { quotes: {}, fx: {} };
      return tolerate('Markets', () => fetchMarket(warn), { quotes: {}, fx: {} }, warn);
    },

    async fetchNews(topics: string[]): Promise<NewsItem[]> {
      if (!enabled.news) return [];
      return tolerate('News', () => fetchNews(topics, warn), [], warn);
    },
  };
}

export interface SourceStatus {
  id: string;
  label: string;
  url: string;
  /** Every source Epoch uses is free and needs no key. */
  requiresKey: false;
  describes: string;
}

/** Shown in the CLI and the UI so it's obvious where the world's facts come from. */
export const SOURCES: SourceStatus[] = [
  { id: 'open-meteo', label: 'Open-Meteo', url: 'https://open-meteo.com', requiresKey: false, describes: 'Current weather for every city' },
  { id: 'yahoo-finance', label: 'Yahoo Finance', url: 'https://finance.yahoo.com', requiresKey: false, describes: 'Equity and index prices' },
  { id: 'coingecko', label: 'CoinGecko', url: 'https://coingecko.com', requiresKey: false, describes: 'Crypto prices' },
  { id: 'frankfurter', label: 'Frankfurter (ECB)', url: 'https://frankfurter.app', requiresKey: false, describes: 'Foreign exchange rates' },
  { id: 'hacker-news', label: 'Hacker News', url: 'https://news.ycombinator.com', requiresKey: false, describes: 'Technology and startup news' },
  { id: 'gdelt', label: 'GDELT', url: 'https://gdeltproject.org', requiresKey: false, describes: 'World news' },
  { id: 'nominatim', label: 'Nominatim (OSM)', url: 'https://nominatim.openstreetmap.org', requiresKey: false, describes: 'Geocoding any place on Earth' },
  { id: 'restcountries', label: 'REST Countries', url: 'https://restcountries.com', requiresKey: false, describes: 'Currencies, languages, populations' },
  { id: 'hipolabs', label: 'Hipolabs Universities', url: 'https://github.com/Hipo/university-domains-list', requiresKey: false, describes: 'Real universities by country' },
];
