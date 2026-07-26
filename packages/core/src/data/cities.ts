/**
 * The world's starting geography.
 *
 * Real cities, real coordinates, real timezones. Cost-of-living is indexed to
 * London = 100 and median salary is gross monthly in the local currency; both
 * drive the economy directly, so an agent in Lagos and an agent in Zurich face
 * genuinely different problems.
 *
 * At runtime `@epoch/world` can enrich or extend this from live sources
 * (Nominatim for geocoding, REST Countries for currency), but the engine never
 * depends on the network to boot.
 */

import type { City } from '../types.ts';

export const CITIES: City[] = [
  { id: 'city:london', name: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.5074, lon: -0.1278, timezone: 'Europe/London', population: 8982000, costOfLivingIndex: 100, medianSalary: 3300, currency: 'GBP', tags: ['finance', 'tech-hub', 'university', 'media'], airport: 'LHR' },
  { id: 'city:san-francisco', name: 'San Francisco', country: 'United States', countryCode: 'US', lat: 37.7749, lon: -122.4194, timezone: 'America/Los_Angeles', population: 815000, costOfLivingIndex: 126, medianSalary: 8200, currency: 'USD', tags: ['tech-hub', 'venture-capital', 'university'], airport: 'SFO' },
  { id: 'city:new-york', name: 'New York', country: 'United States', countryCode: 'US', lat: 40.7128, lon: -74.006, timezone: 'America/New_York', population: 8336000, costOfLivingIndex: 122, medianSalary: 6900, currency: 'USD', tags: ['finance', 'media', 'university', 'tech-hub'], airport: 'JFK' },
  { id: 'city:berlin', name: 'Berlin', country: 'Germany', countryCode: 'DE', lat: 52.52, lon: 13.405, timezone: 'Europe/Berlin', population: 3645000, costOfLivingIndex: 78, medianSalary: 3100, currency: 'EUR', tags: ['tech-hub', 'creative', 'university'], airport: 'BER' },
  { id: 'city:paris', name: 'Paris', country: 'France', countryCode: 'FR', lat: 48.8566, lon: 2.3522, timezone: 'Europe/Paris', population: 2148000, costOfLivingIndex: 89, medianSalary: 3000, currency: 'EUR', tags: ['finance', 'creative', 'university'], airport: 'CDG' },
  { id: 'city:tokyo', name: 'Tokyo', country: 'Japan', countryCode: 'JP', lat: 35.6762, lon: 139.6503, timezone: 'Asia/Tokyo', population: 13960000, costOfLivingIndex: 83, medianSalary: 360000, currency: 'JPY', tags: ['finance', 'industry', 'university', 'tech-hub'], airport: 'HND' },
  { id: 'city:singapore', name: 'Singapore', country: 'Singapore', countryCode: 'SG', lat: 1.3521, lon: 103.8198, timezone: 'Asia/Singapore', population: 5686000, costOfLivingIndex: 96, medianSalary: 5800, currency: 'SGD', tags: ['finance', 'tech-hub', 'shipping'], airport: 'SIN' },
  { id: 'city:bangalore', name: 'Bengaluru', country: 'India', countryCode: 'IN', lat: 12.9716, lon: 77.5946, timezone: 'Asia/Kolkata', population: 8443000, costOfLivingIndex: 26, medianSalary: 55000, currency: 'INR', tags: ['tech-hub', 'university', 'outsourcing'], airport: 'BLR' },
  { id: 'city:lagos', name: 'Lagos', country: 'Nigeria', countryCode: 'NG', lat: 6.5244, lon: 3.3792, timezone: 'Africa/Lagos', population: 14862000, costOfLivingIndex: 30, medianSalary: 250000, currency: 'NGN', tags: ['industry', 'creative', 'fintech'], airport: 'LOS' },
  { id: 'city:nairobi', name: 'Nairobi', country: 'Kenya', countryCode: 'KE', lat: -1.2921, lon: 36.8219, timezone: 'Africa/Nairobi', population: 4397000, costOfLivingIndex: 33, medianSalary: 62000, currency: 'KES', tags: ['fintech', 'university', 'ngo'], airport: 'NBO' },
  { id: 'city:sao-paulo', name: 'São Paulo', country: 'Brazil', countryCode: 'BR', lat: -23.5505, lon: -46.6333, timezone: 'America/Sao_Paulo', population: 12330000, costOfLivingIndex: 38, medianSalary: 4200, currency: 'BRL', tags: ['finance', 'industry', 'university'], airport: 'GRU' },
  { id: 'city:mexico-city', name: 'Mexico City', country: 'Mexico', countryCode: 'MX', lat: 19.4326, lon: -99.1332, timezone: 'America/Mexico_City', population: 9209000, costOfLivingIndex: 37, medianSalary: 18000, currency: 'MXN', tags: ['industry', 'creative', 'university'], airport: 'MEX' },
  { id: 'city:dubai', name: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', lat: 25.2048, lon: 55.2708, timezone: 'Asia/Dubai', population: 3331000, costOfLivingIndex: 71, medianSalary: 15000, currency: 'AED', tags: ['finance', 'trade', 'crypto'], airport: 'DXB' },
  { id: 'city:seoul', name: 'Seoul', country: 'South Korea', countryCode: 'KR', lat: 37.5665, lon: 126.978, timezone: 'Asia/Seoul', population: 9776000, costOfLivingIndex: 76, medianSalary: 3600000, currency: 'KRW', tags: ['tech-hub', 'industry', 'university'], airport: 'ICN' },
  { id: 'city:shanghai', name: 'Shanghai', country: 'China', countryCode: 'CN', lat: 31.2304, lon: 121.4737, timezone: 'Asia/Shanghai', population: 27058000, costOfLivingIndex: 60, medianSalary: 12000, currency: 'CNY', tags: ['finance', 'industry', 'tech-hub'], airport: 'PVG' },
  { id: 'city:zurich', name: 'Zurich', country: 'Switzerland', countryCode: 'CH', lat: 47.3769, lon: 8.5417, timezone: 'Europe/Zurich', population: 421000, costOfLivingIndex: 137, medianSalary: 7800, currency: 'CHF', tags: ['finance', 'university', 'pharma'], airport: 'ZRH' },
  { id: 'city:amsterdam', name: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', lat: 52.3676, lon: 4.9041, timezone: 'Europe/Amsterdam', population: 872000, costOfLivingIndex: 92, medianSalary: 3400, currency: 'EUR', tags: ['tech-hub', 'creative', 'university'], airport: 'AMS' },
  { id: 'city:stockholm', name: 'Stockholm', country: 'Sweden', countryCode: 'SE', lat: 59.3293, lon: 18.0686, timezone: 'Europe/Stockholm', population: 975000, costOfLivingIndex: 88, medianSalary: 38000, currency: 'SEK', tags: ['tech-hub', 'university'], airport: 'ARN' },
  { id: 'city:tel-aviv', name: 'Tel Aviv', country: 'Israel', countryCode: 'IL', lat: 32.0853, lon: 34.7818, timezone: 'Asia/Jerusalem', population: 460000, costOfLivingIndex: 106, medianSalary: 14000, currency: 'ILS', tags: ['tech-hub', 'venture-capital'], airport: 'TLV' },
  { id: 'city:toronto', name: 'Toronto', country: 'Canada', countryCode: 'CA', lat: 43.6532, lon: -79.3832, timezone: 'America/Toronto', population: 2930000, costOfLivingIndex: 85, medianSalary: 5100, currency: 'CAD', tags: ['finance', 'tech-hub', 'university'], airport: 'YYZ' },
  { id: 'city:sydney', name: 'Sydney', country: 'Australia', countryCode: 'AU', lat: -33.8688, lon: 151.2093, timezone: 'Australia/Sydney', population: 5312000, costOfLivingIndex: 97, medianSalary: 6400, currency: 'AUD', tags: ['finance', 'university'], airport: 'SYD' },
  { id: 'city:istanbul', name: 'Istanbul', country: 'Türkiye', countryCode: 'TR', lat: 41.0082, lon: 28.9784, timezone: 'Europe/Istanbul', population: 15462000, costOfLivingIndex: 34, medianSalary: 32000, currency: 'TRY', tags: ['trade', 'industry', 'university'], airport: 'IST' },
  { id: 'city:warsaw', name: 'Warsaw', country: 'Poland', countryCode: 'PL', lat: 52.2297, lon: 21.0122, timezone: 'Europe/Warsaw', population: 1790000, costOfLivingIndex: 49, medianSalary: 8500, currency: 'PLN', tags: ['tech-hub', 'outsourcing', 'university'], airport: 'WAW' },
  { id: 'city:lisbon', name: 'Lisbon', country: 'Portugal', countryCode: 'PT', lat: 38.7223, lon: -9.1393, timezone: 'Europe/Lisbon', population: 545000, costOfLivingIndex: 59, medianSalary: 1500, currency: 'EUR', tags: ['tech-hub', 'creative', 'remote-work'], airport: 'LIS' },
  { id: 'city:buenos-aires', name: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', lat: -34.6037, lon: -58.3816, timezone: 'America/Argentina/Buenos_Aires', population: 3075000, costOfLivingIndex: 32, medianSalary: 700000, currency: 'ARS', tags: ['creative', 'university', 'crypto'], airport: 'EZE' },
  { id: 'city:cape-town', name: 'Cape Town', country: 'South Africa', countryCode: 'ZA', lat: -33.9249, lon: 18.4241, timezone: 'Africa/Johannesburg', population: 4618000, costOfLivingIndex: 40, medianSalary: 28000, currency: 'ZAR', tags: ['creative', 'tourism', 'university'], airport: 'CPT' },
  { id: 'city:cairo', name: 'Cairo', country: 'Egypt', countryCode: 'EG', lat: 30.0444, lon: 31.2357, timezone: 'Africa/Cairo', population: 9540000, costOfLivingIndex: 24, medianSalary: 9000, currency: 'EGP', tags: ['industry', 'university', 'media'], airport: 'CAI' },
  { id: 'city:jakarta', name: 'Jakarta', country: 'Indonesia', countryCode: 'ID', lat: -6.2088, lon: 106.8456, timezone: 'Asia/Jakarta', population: 10562000, costOfLivingIndex: 33, medianSalary: 6000000, currency: 'IDR', tags: ['industry', 'fintech'], airport: 'CGK' },
  { id: 'city:hong-kong', name: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK', lat: 22.3193, lon: 114.1694, timezone: 'Asia/Hong_Kong', population: 7482000, costOfLivingIndex: 105, medianSalary: 22000, currency: 'HKD', tags: ['finance', 'trade', 'university'], airport: 'HKG' },
  { id: 'city:dublin', name: 'Dublin', country: 'Ireland', countryCode: 'IE', lat: 53.3498, lon: -6.2603, timezone: 'Europe/Dublin', population: 592000, costOfLivingIndex: 94, medianSalary: 3900, currency: 'EUR', tags: ['tech-hub', 'finance', 'university'], airport: 'DUB' },
  { id: 'city:boston', name: 'Boston', country: 'United States', countryCode: 'US', lat: 42.3601, lon: -71.0589, timezone: 'America/New_York', population: 675000, costOfLivingIndex: 112, medianSalary: 6600, currency: 'USD', tags: ['university', 'biotech', 'venture-capital'], airport: 'BOS' },
  { id: 'city:austin', name: 'Austin', country: 'United States', countryCode: 'US', lat: 30.2672, lon: -97.7431, timezone: 'America/Chicago', population: 964000, costOfLivingIndex: 89, medianSalary: 5900, currency: 'USD', tags: ['tech-hub', 'university', 'creative'], airport: 'AUS' },
  { id: 'city:bangkok', name: 'Bangkok', country: 'Thailand', countryCode: 'TH', lat: 13.7563, lon: 100.5018, timezone: 'Asia/Bangkok', population: 10539000, costOfLivingIndex: 39, medianSalary: 25000, currency: 'THB', tags: ['tourism', 'trade', 'remote-work'], airport: 'BKK' },
  { id: 'city:madrid', name: 'Madrid', country: 'Spain', countryCode: 'ES', lat: 40.4168, lon: -3.7038, timezone: 'Europe/Madrid', population: 3223000, costOfLivingIndex: 68, medianSalary: 2200, currency: 'EUR', tags: ['finance', 'university', 'creative'], airport: 'MAD' },
  { id: 'city:milan', name: 'Milan', country: 'Italy', countryCode: 'IT', lat: 45.4642, lon: 9.19, timezone: 'Europe/Rome', population: 1372000, costOfLivingIndex: 76, medianSalary: 2400, currency: 'EUR', tags: ['finance', 'fashion', 'university'], airport: 'MXP' },
  { id: 'city:vancouver', name: 'Vancouver', country: 'Canada', countryCode: 'CA', lat: 49.2827, lon: -123.1207, timezone: 'America/Vancouver', population: 675000, costOfLivingIndex: 92, medianSalary: 5000, currency: 'CAD', tags: ['tech-hub', 'creative'], airport: 'YVR' },
  { id: 'city:seattle', name: 'Seattle', country: 'United States', countryCode: 'US', lat: 47.6062, lon: -122.3321, timezone: 'America/Los_Angeles', population: 737000, costOfLivingIndex: 108, medianSalary: 7400, currency: 'USD', tags: ['tech-hub', 'university'], airport: 'SEA' },
  { id: 'city:hyderabad', name: 'Hyderabad', country: 'India', countryCode: 'IN', lat: 17.385, lon: 78.4867, timezone: 'Asia/Kolkata', population: 6809000, costOfLivingIndex: 23, medianSalary: 48000, currency: 'INR', tags: ['tech-hub', 'pharma', 'university'], airport: 'HYD' },
  { id: 'city:accra', name: 'Accra', country: 'Ghana', countryCode: 'GH', lat: 5.6037, lon: -0.187, timezone: 'Africa/Accra', population: 2388000, costOfLivingIndex: 31, medianSalary: 3000, currency: 'GHS', tags: ['fintech', 'university', 'creative'], airport: 'ACC' },
  { id: 'city:tallinn', name: 'Tallinn', country: 'Estonia', countryCode: 'EE', lat: 59.437, lon: 24.7536, timezone: 'Europe/Tallinn', population: 438000, costOfLivingIndex: 62, medianSalary: 1900, currency: 'EUR', tags: ['tech-hub', 'e-government', 'crypto'], airport: 'TLL' },
];

export const CITY_BY_ID: Record<string, City> = Object.fromEntries(CITIES.map((c) => [c.id, c]));

/** Great-circle distance in kilometres — used for travel time and cost. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough commercial flight duration in hours, including turnaround. */
export function flightHours(km: number): number {
  return 1.2 + km / 800;
}

/** Indicative economy-class fare in USD. */
export function flightCostUSD(km: number): number {
  return Math.round(60 + km * 0.11);
}
