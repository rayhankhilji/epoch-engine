/**
 * Geography and institutions.
 *
 *   Nominatim (OpenStreetMap) — geocode any place on Earth
 *   REST Countries            — currency, languages, region, population
 *   Hipolabs                  — real universities, by country
 *
 * This is what lets a scenario name a city Epoch has never heard of and still
 * get real coordinates, a real timezone and a real currency for it.
 */

import type { City } from '@epoch/core';
import { slugId } from '@epoch/core';
import { fetchJson } from './http.ts';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const REST_COUNTRIES = 'https://restcountries.com/v3.1';
const UNIVERSITIES = 'https://universities.hipolabs.com/search';

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  addresstype?: string;
  type?: string;
  extratags?: Record<string, string>;
  address?: { country?: string; country_code?: string };
}

export interface GeocodeResult {
  name: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Look up a place by name. Nominatim asks for one request per second and a
 * contact string in the User-Agent — both are honoured here (see `http.ts`),
 * and results are cached for a day since coordinates don't move.
 */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=1`;
  const results = await fetchJson<NominatimPlace[]>(url, { ttlMs: 24 * 60 * 60_000 });

  const place = results[0];
  if (!place) return null;

  return {
    name: place.name ?? place.display_name.split(',')[0]!.trim(),
    country: place.address?.country ?? '',
    countryCode: (place.address?.country_code ?? '').toUpperCase(),
    lat: Number(place.lat),
    lon: Number(place.lon),
    displayName: place.display_name,
  };
}

interface RestCountry {
  name: { common: string; official: string };
  cca2: string;
  currencies?: Record<string, { name: string; symbol?: string }>;
  languages?: Record<string, string>;
  region?: string;
  subregion?: string;
  population?: number;
  timezones?: string[];
}

export interface CountryFacts {
  name: string;
  code: string;
  currency: string;
  currencyName: string;
  languages: string[];
  region: string;
  population: number;
  timezone: string;
}

export async function fetchCountry(alpha2: string): Promise<CountryFacts | null> {
  const url = `${REST_COUNTRIES}/alpha/${alpha2.toLowerCase()}?fields=name,cca2,currencies,languages,region,subregion,population,timezones`;
  const payload = await fetchJson<RestCountry | RestCountry[]>(url, { ttlMs: 7 * 24 * 60 * 60_000 });
  const country = Array.isArray(payload) ? payload[0] : payload;
  if (!country) return null;

  const [currencyCode, currency] = Object.entries(country.currencies ?? {})[0] ?? ['USD', { name: 'US Dollar' }];

  return {
    name: country.name.common,
    code: country.cca2,
    currency: currencyCode,
    currencyName: currency.name,
    languages: Object.values(country.languages ?? {}),
    region: country.subregion ?? country.region ?? '',
    population: country.population ?? 0,
    timezone: country.timezones?.[0] ?? 'UTC',
  };
}

interface HipolabsUniversity {
  name: string;
  country: string;
  alpha_two_code: string;
  'state-province': string | null;
  web_pages: string[];
  domains: string[];
}

export interface University {
  name: string;
  country: string;
  countryCode: string;
  website?: string;
}

/** Real universities, used to give educated agents somewhere they actually went. */
export async function fetchUniversities(country: string, limit = 40): Promise<University[]> {
  const url = `${UNIVERSITIES}?country=${encodeURIComponent(country)}`;
  const payload = await fetchJson<HipolabsUniversity[]>(url, { ttlMs: 7 * 24 * 60 * 60_000 });

  return payload.slice(0, limit).map((entry) => ({
    name: entry.name,
    country: entry.country,
    countryCode: entry.alpha_two_code,
    website: entry.web_pages[0],
  }));
}

/**
 * Build a `City` for a place Epoch's bundled dataset doesn't know about, using
 * live geocoding plus country facts. Cost-of-living and salary are estimated
 * from the country's profile — no free API publishes them, and a rough figure
 * grounded in real population and currency beats refusing to model the place.
 */
export async function resolveCity(
  query: string,
  overrides: Partial<City> = {},
): Promise<City | null> {
  const place = await geocode(query);
  if (!place) return null;

  const country = place.countryCode ? await fetchCountry(place.countryCode).catch(() => null) : null;

  const costOfLivingIndex = overrides.costOfLivingIndex ?? estimateCostOfLiving(country?.region ?? '');
  const currency = overrides.currency ?? country?.currency ?? 'USD';

  return {
    id: overrides.id ?? slugId('city', place.name),
    name: place.name,
    country: place.country || country?.name || 'Unknown',
    countryCode: place.countryCode || country?.code || 'XX',
    lat: place.lat,
    lon: place.lon,
    timezone: overrides.timezone ?? country?.timezone ?? 'UTC',
    population: overrides.population ?? 500_000,
    costOfLivingIndex,
    medianSalary: overrides.medianSalary ?? estimateSalary(costOfLivingIndex, currency),
    currency,
    tags: overrides.tags ?? [],
    airport: overrides.airport,
  };
}

/** Rough regional cost-of-living index, London = 100. */
function estimateCostOfLiving(region: string): number {
  const byRegion: Record<string, number> = {
    'Northern Europe': 92, 'Western Europe': 88, 'Northern America': 105,
    'Australia and New Zealand': 95, 'Eastern Asia': 72, 'Western Asia': 62,
    'Southern Europe': 68, 'Eastern Europe': 48, 'South-Eastern Asia': 38,
    'Southern Asia': 26, 'South America': 36, 'Central America': 38,
    'Northern Africa': 28, 'Western Africa': 31, 'Eastern Africa': 33,
    'Southern Africa': 40, 'Caribbean': 45, 'Middle Africa': 30,
  };
  return byRegion[region] ?? 55;
}

/** Median gross monthly salary implied by the cost-of-living index. */
function estimateSalary(costOfLivingIndex: number, currency: string): number {
  const usdPerMonth = 350 + costOfLivingIndex * 45;
  // Currencies with very small unit values need a proportionate figure.
  const roughUnitsPerUSD: Record<string, number> = {
    JPY: 155, KRW: 1370, INR: 84, NGN: 1550, IDR: 16000, VND: 25000,
    ARS: 1020, KES: 130, ZAR: 18, EGP: 48, PKR: 278, LKR: 300, COP: 4200,
  };
  return Math.round(usdPerMonth * (roughUnitsPerUSD[currency] ?? 1));
}
