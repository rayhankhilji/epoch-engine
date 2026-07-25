/**
 * Markets and currencies.
 *
 *   Equities & indices — Stooq CSV quotes
 *   Crypto             — CoinGecko public API
 *   FX                 — Frankfurter (European Central Bank reference rates)
 *
 * All three are free and keyless. When an agent in Lagos buys Apple stock, the
 * price they pay is the price Apple actually traded at, and the naira they pay
 * it in converts at a real ECB rate.
 */

import type { Quote } from '@epoch/core';
import { fetchJson, fetchText } from './http.ts';

/** The instruments a world tracks by default. */
export const DEFAULT_SYMBOLS = {
  stocks: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', 'META'],
  indices: ['^SPX', '^NDQ', '^DJI', '^FTM'],
  crypto: ['bitcoin', 'ethereum', 'solana'],
};

const STOOQ = 'https://stooq.com/q/l/';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';
const FRANKFURTER = 'https://api.frankfurter.app/latest';

/** Human-readable names so prompts don't just show tickers. */
const NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet',
  AMZN: 'Amazon', TSLA: 'Tesla', META: 'Meta',
  '^SPX': 'S&P 500', '^NDQ': 'Nasdaq 100', '^DJI': 'Dow Jones', '^FTM': 'FTSE 100',
  bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana',
};

// ─────────────────────────────────────────────────────────────────────────────
// Equities and indices — Stooq
// ─────────────────────────────────────────────────────────────────────────────

/** Stooq wants lowercase symbols with a market suffix for US equities. */
function toStooqSymbol(symbol: string): string {
  if (symbol.startsWith('^')) return symbol.toLowerCase();
  return `${symbol.toLowerCase()}.us`;
}

export async function fetchStockQuotes(symbols: string[] = [...DEFAULT_SYMBOLS.stocks, ...DEFAULT_SYMBOLS.indices]): Promise<Quote[]> {
  if (symbols.length === 0) return [];

  const url = `${STOOQ}?s=${symbols.map(toStooqSymbol).join(',')}&f=sd2t2ohlcv&h&e=csv`;
  const csv = await fetchText(url, { ttlMs: 15 * 60_000 });

  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) return [];

  const columns = header.split(',').map((h) => h.trim().toLowerCase());
  const index = (name: string) => columns.indexOf(name);

  const quotes: Quote[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    const close = Number(cells[index('close')]);
    const open = Number(cells[index('open')]);
    if (!Number.isFinite(close) || close <= 0) continue; // "N/D" outside market hours

    const stooqSymbol = (cells[index('symbol')] ?? '').trim().toLowerCase();
    const symbol = symbols.find((s) => toStooqSymbol(s) === stooqSymbol) ?? stooqSymbol.toUpperCase();

    quotes.push({
      symbol,
      name: NAMES[symbol] ?? symbol,
      price: close,
      changePct: Number.isFinite(open) && open > 0 ? ((close - open) / open) * 100 : 0,
      currency: 'USD',
      kind: symbol.startsWith('^') ? 'index' : 'stock',
      fetchedAt: Date.now(),
    });
  }

  return quotes;
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
