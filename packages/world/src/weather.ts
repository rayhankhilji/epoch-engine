/**
 * Weather — Open-Meteo.
 *
 * Free, keyless, no rate limit worth worrying about, and it accepts every city
 * in one request, so a 40-city world costs exactly one call per simulated day.
 *
 * https://open-meteo.com/
 */

import type { City, Weather } from '@epoch/core';
import { fetchJson } from './http.ts';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoCurrent {
  temperature_2m?: number;
  precipitation?: number;
  wind_speed_10m?: number;
  weather_code?: number;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  current?: OpenMeteoCurrent;
}

/** WMO weather interpretation codes, phrased the way a person would say them. */
export const WEATHER_CODES: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'foggy',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'heavy freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'heavy rain showers',
  82: 'violent rain showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorms',
  96: 'thunderstorms with hail',
  99: 'severe thunderstorms with hail',
};

export function describeWeather(code: number): string {
  return WEATHER_CODES[code] ?? 'unremarkable';
}

/**
 * Current conditions for every city, in one request. Open-Meteo returns an
 * array when given comma-separated coordinates and a bare object for one city,
 * so both shapes are handled.
 */
export async function fetchWeather(cities: City[], simTime = 0): Promise<Weather[]> {
  if (cities.length === 0) return [];

  const url =
    `${ENDPOINT}?latitude=${cities.map((c) => c.lat.toFixed(4)).join(',')}` +
    `&longitude=${cities.map((c) => c.lon.toFixed(4)).join(',')}` +
    `&current=temperature_2m,precipitation,wind_speed_10m,weather_code`;

  const payload = await fetchJson<OpenMeteoResponse | OpenMeteoResponse[]>(url, {
    // Weather is refreshed once per simulated day; an hour of real-world
    // caching keeps repeated runs from hammering a free service.
    ttlMs: 60 * 60_000,
  });

  const entries = Array.isArray(payload) ? payload : [payload];

  return cities.flatMap((city, index) => {
    const entry = entries[index];
    const current = entry?.current;
    if (!current) return [];

    const code = current.weather_code ?? 0;
    return [
      {
        cityId: city.id,
        temperatureC: current.temperature_2m ?? 0,
        precipitationMm: current.precipitation ?? 0,
        windKph: current.wind_speed_10m ?? 0,
        code,
        description: describeWeather(code),
        observedAt: simTime,
      },
    ];
  });
}
