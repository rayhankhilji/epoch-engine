/**
 * Markets and currencies.
 *
 *   Equities & indices — Yahoo Finance's public spark endpoint
 *   Crypto             — CoinGecko public API
 *   FX                 — Frankfurter (European Central Bank reference rates)
 *
 * All three are free and keyless. When an agent in Lagos buys Apple stock, the
 * price they pay is the price Apple actually traded at, and the naira they pay
 * it in converts at a real ECB rate.
 *
 * (Stooq was the original equities source and had to be replaced: it now gates
 * its CSV endpoint behind a JavaScript proof-of-work challenge, which a server
 * cannot answer. Everything here is verified reachable without a browser.)
 */

import type { Quote } from '@epoch/core';
import { fetchJson } from './http.ts';

/** The instruments a world tracks by default. */
export const DEFAULT_SYMBOLS = {
  stocks: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META'],
  indices: ['^GSPC', '^IXIC', '^DJI', '^FTSE'],
  crypto: ['bitcoin', 'ethereum', 'solana'],
};

const YAHOO = 'https://query1.finance.yahoo.com/v7/finance/spark';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';
const FRANKFURTER = 'https://api.frankfurter.app/latest';

/** Fallback names, used when the provider doesn't supply one. */
const NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet',
  AMZN: 'Amazon', TSLA: 'Tesla', META: 'Meta',
  '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq', '^DJI': 'Dow Jones', '^FTSE': 'FTSE 100',
  bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana',
};

// ─────────────────────────────────────────────────────────────────────────────
// Equities and indices — Yahoo Finance
// ─────────────────────────────────────────────────────────────────────────────

interface SparkMeta {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  shortName?: string;
  longName?: string;
  instrumentType?: string;
}

interface SparkResponse {
  spark?: { result?: Array<{ symbol: string; response?: Array<{ meta?: SparkMeta }> }> };
}

/** Every symbol in one request, with the day's change against previous close. */
export async function fetchStockQuotes(
  symbols: string[] = [...DEFAULT_SYMBOLS.stocks, ...DEFAULT_SYMBOLS.indices],
): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const url = `${YAHOO}?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=1d`;
  const payload = await fetchJson<SparkResponse>(url, {
    ttlMs: 15 * 60_000,
    // Yahoo's public endpoints reject requests without a browser-ish agent.
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; epoch-engine/0.1)' },
  });

  return (payload.spark?.result ?? []).flatMap((entry) => {
    const meta = entry.response?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    // A halted or unknown symbol comes back with metadata but no price.
    if (!meta || price == null || !Number.isFinite(price)) return [];

    const previous = meta.chartPreviousClose ?? meta.previousClose;
    const symbol = meta.symbol ?? entry.symbol;

    return [
      {
        symbol,
        name: meta.shortName ?? meta.longName ?? NAMES[symbol] ?? symbol,
        price,
        changePct: previous && previous > 0 ? ((price - previous) / previous) * 100 : 0,
        currency: meta.currency ?? 'USD',
        kind: symbol.startsWith('^') ? ('index' as const) : ('stock' as const),
        fetchedAt: Date.now(),
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto — CoinGecko
// ─────────────────────────────────────────────────────────────────────────────

type CoinGeckoResponse = Record<string, { usd?: number; usd_24h_change?: number }>;

export async function fetchCryptoQuotes(ids: string[] = DEFAULT_SYMBOLS.crypto): Promise<Quote[]> {
  if (ids.length === 0) return [];

  const url = `${COINGECKO}?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`;
  const payload = await fetchJson<CoinGeckoResponse>(url, { ttlMs: 10 * 60_000 });

  return Object.entries(payload).flatMap(([id, data]) => {
    if (data.usd == null) return [];
    return [
      {
        symbol: id,
        name: NAMES[id] ?? id,
        price: data.usd,
        changePct: data.usd_24h_change ?? 0,
        currency: 'USD',
        kind: 'crypto' as const,
        fetchedAt: Date.now(),
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FX — Frankfurter
// ─────────────────────────────────────────────────────────────────────────────

interface FrankfurterResponse {
  base: string;
  rates: Record<string, number>;
}

/**
 * USD per one unit of each currency — the direction `@epoch/core` expects.
 * Frankfurter quotes units-per-USD, so every rate is inverted here.
 */
export async function fetchFxRates(): Promise<Record<string, number>> {
  const payload = await fetchJson<FrankfurterResponse>(`${FRANKFURTER}?from=USD`, {
    ttlMs: 6 * 60 * 60_000, // ECB publishes once a working day
  });

  const rates: Record<string, number> = { USD: 1 };
  for (const [currency, unitsPerUSD] of Object.entries(payload.rates)) {
    if (Number.isFinite(unitsPerUSD) && unitsPerUSD > 0) rates[currency] = 1 / unitsPerUSD;
  }
  return rates;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  quotes: Record<string, Quote>;
  fx: Record<string, number>;
}

/**
 * One market refresh. Each source is settled independently so a CoinGecko rate
 * limit doesn't cost you the stock prices too.
 */
export async function fetchMarket(
  onWarning?: (message: string, detail?: unknown) => void,
): Promise<MarketSnapshot> {
  const [stocks, crypto, fx] = await Promise.allSettled([
    fetchStockQuotes(),
    fetchCryptoQuotes(),
    fetchFxRates(),
  ]);

  const quotes: Record<string, Quote> = {};

  if (stocks.status === 'fulfilled') {
    for (const quote of stocks.value) quotes[quote.symbol] = quote;
  } else {
    onWarning?.('Stooq quotes unavailable', stocks.reason);
  }

  if (crypto.status === 'fulfilled') {
    for (const quote of crypto.value) quotes[quote.symbol] = quote;
  } else {
    onWarning?.('CoinGecko quotes unavailable', crypto.reason);
  }

  if (fx.status === 'rejected') onWarning?.('Frankfurter FX rates unavailable', fx.reason);

  return { quotes, fx: fx.status === 'fulfilled' ? fx.value : {} };
}
