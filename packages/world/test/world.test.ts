/**
 * These tests never touch the network. `fetch` is stubbed with recorded shapes
 * from each provider so the parsing logic is exercised hermetically — which is
 * also what stops CI from depending on nine third-party services staying up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { clearHttpCache, fetchJson, tolerate, userAgent, HttpError } from '../src/http.ts';
import { fetchWeather, describeWeather } from '../src/weather.ts';
import { fetchStockQuotes, fetchCryptoQuotes, fetchFxRates, fetchMarket } from '../src/markets.ts';
import { fetchHackerNews, fetchGdelt, inferTopics } from '../src/news.ts';
import { geocode, fetchCountry, resolveCity } from '../src/geo.ts';
import { createWorldData, SOURCES } from '../src/index.ts';
import { CITY_BY_ID } from '@epoch/core';

type Responder = (url: string) => { status?: number; body: string };

const realFetch = globalThis.fetch;

function stubFetch(responder: Responder): () => void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const { status = 200, body } = responder(url);
    return new Response(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
  }) as typeof fetch;

  clearHttpCache();
  return () => {
    globalThis.fetch = realFetch;
    clearHttpCache();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP layer
// ─────────────────────────────────────────────────────────────────────────────

test('the user agent identifies Epoch and honours a contact email', () => {
  assert.match(userAgent(), /epoch-engine/);
  process.env.EPOCH_CONTACT_EMAIL = 'someone@example.com';
  try {
    assert.match(userAgent(), /someone@example\.com/);
  } finally {
    delete process.env.EPOCH_CONTACT_EMAIL;
  }
});

test('responses are cached within their TTL', async () => {
  let calls = 0;
  const restore = stubFetch((url) => {
    calls++;
    void url;
    return { body: '{"value":1}' };
  });

  try {
    await fetchJson('https://example.com/thing', { ttlMs: 60_000 });
    await fetchJson('https://example.com/thing', { ttlMs: 60_000 });
    assert.equal(calls, 1, 'the second call should come from cache');
  } finally {
    restore();
  }
});

test('caching can be bypassed per call', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls++;
    return { body: '{"value":1}' };
  });

  try {
    await fetchJson('https://example.com/uncached', { ttlMs: 0 });
    await fetchJson('https://example.com/uncached', { ttlMs: 0 });
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test('a 404 is not retried and surfaces as an HttpError', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls++;
    return { status: 404, body: 'nope' };
  });

  try {
    await assert.rejects(() => fetchJson('https://example.com/missing', { ttlMs: 0, retries: 2 }), HttpError);
    assert.equal(calls, 1, 'client errors should not be retried');
  } finally {
    restore();
  }
});

test('a 500 is retried', async () => {
  let calls = 0;
  const restore = stubFetch(() => {
    calls++;
    return calls < 2 ? { status: 500, body: 'boom' } : { body: '{"ok":true}' };
  });

  try {
    const result = await fetchJson<{ ok: boolean }>('https://example.com/flaky', { ttlMs: 0, retries: 2 });
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test('non-JSON where JSON was expected fails clearly', async () => {
  const restore = stubFetch(() => ({ body: '<html>maintenance</html>' }));
  try {
    await assert.rejects(() => fetchJson('https://example.com/html', { ttlMs: 0 }), /not JSON/);
  } finally {
    restore();
  }
});

test('tolerate converts a failure into a fallback instead of throwing', async () => {
  const warnings: string[] = [];
  const value = await tolerate(
    'Test source',
    async () => {
      throw new Error('down');
    },
    ['fallback'],
    (message) => warnings.push(message),
  );

  assert.deepEqual(value, ['fallback']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Test source/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Weather
// ─────────────────────────────────────────────────────────────────────────────

test('WMO codes map to plain descriptions', () => {
  assert.equal(describeWeather(0), 'clear');
  assert.equal(describeWeather(65), 'heavy rain');
  assert.equal(describeWeather(95), 'thunderstorms');
  assert.equal(describeWeather(4242), 'unremarkable');
});

test('Open-Meteo results are matched back to their cities', async () => {
  const cities = [CITY_BY_ID['city:london']!, CITY_BY_ID['city:tokyo']!];
  const restore = stubFetch(() => ({
    body: JSON.stringify([
      { latitude: 51.5, longitude: -0.13, current: { temperature_2m: 11.4, precipitation: 0.3, wind_speed_10m: 18, weather_code: 61 } },
      { latitude: 35.68, longitude: 139.65, current: { temperature_2m: 24.1, precipitation: 0, wind_speed_10m: 7, weather_code: 0 } },
    ]),
  }));

  try {
    const weather = await fetchWeather(cities, 1000);
    assert.equal(weather.length, 2);
    assert.equal(weather[0]!.cityId, 'city:london');
    assert.equal(weather[0]!.description, 'light rain');
    assert.equal(weather[0]!.temperatureC, 11.4);
    assert.equal(weather[1]!.cityId, 'city:tokyo');
    assert.equal(weather[1]!.description, 'clear');
    assert.equal(weather[1]!.observedAt, 1000);
  } finally {
    restore();
  }
});

test('a single-city request handles the non-array response shape', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({ latitude: 51.5, longitude: -0.13, current: { temperature_2m: 9, weather_code: 3 } }),
  }));

  try {
    const weather = await fetchWeather([CITY_BY_ID['city:london']!]);
    assert.equal(weather.length, 1);
    assert.equal(weather[0]!.description, 'overcast');
  } finally {
    restore();
  }
});

test('no cities means no request', async () => {
  assert.deepEqual(await fetchWeather([]), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────────────────────────

/** A recorded Yahoo Finance spark response. */
function sparkBody(entries: Array<[string, number, number, string?]>): string {
  return JSON.stringify({
    spark: {
      result: entries.map(([symbol, price, previous, name]) => ({
        symbol,
        response: [
          {
            meta: {
              symbol,
              currency: 'USD',
              regularMarketPrice: price,
              chartPreviousClose: previous,
              shortName: name,
            },
          },
        ],
      })),
    },
  });
}

const SPARK = sparkBody([
  ['AAPL', 214.2, 210, 'Apple Inc.'],
  ['MSFT', 396, 400, 'Microsoft Corporation'],
]);

test('Yahoo Finance quotes parse with a change against previous close', async () => {
  const restore = stubFetch(() => ({ body: SPARK }));
  try {
    const quotes = await fetchStockQuotes(['AAPL', 'MSFT']);
    assert.equal(quotes.length, 2);

    const apple = quotes.find((q) => q.symbol === 'AAPL')!;
    assert.equal(apple.name, 'Apple Inc.');
    assert.equal(apple.price, 214.2);
    assert.equal(apple.currency, 'USD');
    assert.equal(apple.kind, 'stock');
    assert.ok(apple.changePct > 0);

    const microsoft = quotes.find((q) => q.symbol === 'MSFT')!;
    assert.ok(microsoft.changePct < 0, 'a down day should be negative');
  } finally {
    restore();
  }
});

test('a symbol with no price is skipped rather than charted at zero', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({
      spark: { result: [{ symbol: 'HALTED', response: [{ meta: { symbol: 'HALTED', currency: 'USD' } }] }] },
    }),
  }));
  try {
    assert.deepEqual(await fetchStockQuotes(['HALTED']), []);
  } finally {
    restore();
  }
});

test('index symbols are typed as indices', async () => {
  const restore = stubFetch(() => ({ body: sparkBody([['^GSPC', 5080, 5000, 'S&P 500']]) }));
  try {
    const quotes = await fetchStockQuotes(['^GSPC']);
    assert.equal(quotes[0]!.kind, 'index');
    assert.equal(quotes[0]!.name, 'S&P 500');
  } finally {
    restore();
  }
});

test('CoinGecko prices parse, including 24h change', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({
      bitcoin: { usd: 91234.5, usd_24h_change: -1.82 },
      ethereum: { usd: 3120.1, usd_24h_change: 2.4 },
      solana: {},
    }),
  }));

  try {
    const quotes = await fetchCryptoQuotes(['bitcoin', 'ethereum', 'solana']);
    assert.equal(quotes.length, 2, 'entries without a price are skipped');
    assert.equal(quotes[0]!.symbol, 'bitcoin');
    assert.equal(quotes[0]!.name, 'Bitcoin');
    assert.equal(quotes[0]!.kind, 'crypto');
    assert.equal(quotes[0]!.changePct, -1.82);
  } finally {
    restore();
  }
});

test('FX rates are inverted into USD-per-unit', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({ base: 'USD', rates: { EUR: 0.92, GBP: 0.79, JPY: 156.0 } }),
  }));

  try {
    const fx = await fetchFxRates();
    assert.equal(fx.USD, 1);
    // Frankfurter says 0.92 EUR per USD, so one EUR must be worth ~1.087 USD.
    assert.ok(Math.abs(fx.EUR! - 1 / 0.92) < 1e-9);
    assert.ok(fx.GBP! > 1, 'sterling is worth more than a dollar');
    assert.ok(fx.JPY! < 0.01, 'the yen is worth a fraction of a cent');
  } finally {
    restore();
  }
});

test('one failing market source does not cost you the others', async () => {
  const warnings: string[] = [];
  const restore = stubFetch((url) => {
    if (url.includes('coingecko')) return { status: 500, body: 'down' };
    if (url.includes('finance.yahoo.com')) return { body: SPARK };
    return { body: JSON.stringify({ base: 'USD', rates: { EUR: 0.92 } }) };
  });

  try {
    const snapshot = await fetchMarket((message) => warnings.push(message));
    assert.ok(snapshot.quotes['AAPL'], 'stocks still arrived');
    assert.ok(snapshot.fx['EUR'], 'FX still arrived');
    assert.equal(snapshot.quotes['bitcoin'], undefined);
    assert.ok(warnings.some((w) => w.includes('CoinGecko')));
  } finally {
    restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// News
// ─────────────────────────────────────────────────────────────────────────────

test('topic inference routes stories to the agents who would care', () => {
  assert.ok(inferTopics('OpenAI releases a new reasoning model').includes('artificial intelligence'));
  assert.ok(inferTopics('Startup raises $40M Series B').includes('startups'));
  assert.ok(inferTopics('Bitcoin breaks $90,000').includes('crypto'));
  assert.deepEqual(inferTopics('A quiet afternoon somewhere'), ['world']);
});

test('Hacker News stories parse, with a fallback URL for text posts', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({
      hits: [
        { objectID: '111', title: 'Show HN: I built a compiler', url: 'https://example.com/compiler', created_at: '2026-07-24T10:00:00.000Z' },
        { objectID: '222', title: 'Ask HN: how do you hire?', url: null, created_at: '2026-07-24T09:00:00.000Z' },
        { objectID: '333', title: null },
      ],
    }),
  }));

  try {
    const news = await fetchHackerNews();
    assert.equal(news.length, 2, 'untitled entries are dropped');
    assert.equal(news[0]!.source, 'Hacker News');
    assert.match(news[1]!.url!, /news\.ycombinator\.com/);
  } finally {
    restore();
  }
});

test('GDELT articles parse, including its compact date format', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({
      articles: [
        { url: 'https://news.example/story', title: 'Central bank holds rates', domain: 'news.example', seendate: '20260724T120000Z' },
        { url: undefined, title: 'Broken entry' },
      ],
    }),
  }));

  try {
    const news = await fetchGdelt('economy');
    assert.equal(news.length, 1);
    assert.equal(news[0]!.source, 'news.example');
    assert.equal(news[0]!.publishedAt, Date.UTC(2026, 6, 24, 12, 0, 0));
    assert.ok(news[0]!.topics.includes('finance'));
  } finally {
    restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Geography
// ─────────────────────────────────────────────────────────────────────────────

test('geocoding returns coordinates and a country', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify([
      {
        lat: '-1.2864',
        lon: '36.8172',
        display_name: 'Nairobi, Kenya',
        name: 'Nairobi',
        address: { country: 'Kenya', country_code: 'ke' },
      },
    ]),
  }));

  try {
    const place = await geocode('Nairobi');
    assert.equal(place!.name, 'Nairobi');
    assert.equal(place!.countryCode, 'KE');
    assert.ok(Math.abs(place!.lat + 1.2864) < 1e-6);
  } finally {
    restore();
  }
});

test('an unknown place geocodes to null rather than throwing', async () => {
  const restore = stubFetch(() => ({ body: '[]' }));
  try {
    assert.equal(await geocode('Definitely Not A Place'), null);
  } finally {
    restore();
  }
});

test('country facts extract the primary currency', async () => {
  const restore = stubFetch(() => ({
    body: JSON.stringify({
      name: { common: 'Kenya', official: 'Republic of Kenya' },
      cca2: 'KE',
      currencies: { KES: { name: 'Kenyan shilling', symbol: 'Sh' } },
      languages: { eng: 'English', swa: 'Swahili' },
      region: 'Africa',
      subregion: 'Eastern Africa',
      population: 53771300,
      timezones: ['UTC+03:00'],
    }),
  }));

  try {
    const facts = await fetchCountry('KE');
    assert.equal(facts!.currency, 'KES');
    assert.deepEqual(facts!.languages, ['English', 'Swahili']);
    assert.equal(facts!.region, 'Eastern Africa');
  } finally {
    restore();
  }
});

test('a city Epoch has never heard of can be resolved from live data', async () => {
  const restore = stubFetch((url) => {
    if (url.includes('nominatim')) {
      return {
        body: JSON.stringify([
          { lat: '14.5995', lon: '120.9842', display_name: 'Manila, Philippines', name: 'Manila', address: { country: 'Philippines', country_code: 'ph' } },
        ]),
      };
    }
    return {
      body: JSON.stringify({
        name: { common: 'Philippines', official: 'Republic of the Philippines' },
        cca2: 'PH',
        currencies: { PHP: { name: 'Philippine peso' } },
        languages: { eng: 'English' },
        region: 'Asia',
        subregion: 'South-Eastern Asia',
        population: 109581085,
        timezones: ['UTC+08:00'],
      }),
    };
  });

  try {
    const city = await resolveCity('Manila');
    assert.equal(city!.id, 'city:manila');
    assert.equal(city!.currency, 'PHP');
    assert.equal(city!.countryCode, 'PH');
    assert.ok(city!.costOfLivingIndex > 0);
    assert.ok(city!.medianSalary > 0, 'a plausible salary is estimated for the local currency');
  } finally {
    restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The data source
// ─────────────────────────────────────────────────────────────────────────────

test('every documented source is free and keyless', () => {
  assert.ok(SOURCES.length >= 8);
  for (const source of SOURCES) {
    assert.equal(source.requiresKey, false, `${source.label} must not require a key`);
    assert.match(source.url, /^https?:\/\//);
  }
});

test('sources can be switched off for offline work', async () => {
  const data = createWorldData({ weather: false, markets: false, news: false });
  assert.deepEqual(await data.fetchWeather!([CITY_BY_ID['city:london']!]), []);
  assert.deepEqual(await data.fetchMarket!(), { quotes: {}, fx: {} });
  assert.deepEqual(await data.fetchNews!([]), []);
});

test('a total network outage degrades to empty data, never an exception', async () => {
  const warnings: string[] = [];
  const restore = stubFetch(() => {
    throw new Error('ENETDOWN');
  });

  try {
    const data = createWorldData({ onWarning: (m) => warnings.push(m) });
    assert.deepEqual(await data.fetchWeather!([CITY_BY_ID['city:london']!]), []);
    assert.deepEqual(await data.fetchNews!(['startups']), []);
    const market = await data.fetchMarket!();
    assert.deepEqual(market.quotes, {});
    assert.ok(warnings.length > 0, 'the outage was reported rather than hidden');
  } finally {
    restore();
  }
});
