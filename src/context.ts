import axios from 'axios';
import { config } from './config';
import { UserProfile } from './types';

type Weather = { summary: string; temperatureC: number; temperatureF: number } | null;

const weatherCache = new Map<string, { data: Weather; at: number }>();

function fToC(f: number) { return (f - 32) * 5 / 9; }
function cToF(c: number) { return c * 9 / 5 + 32; }

export async function getWeather(profile?: UserProfile): Promise<Weather> {
  if (!config.context.weatherEnabled) return null;
  if (!profile?.latitude || !profile?.longitude) return null;
  const key = `${profile.latitude.toFixed(3)},${profile.longitude.toFixed(3)}`;
  const cached = weatherCache.get(key);
  const now = Date.now();
  const ttl = config.context.weatherCacheMs;
  if (cached && (now - cached.at) < ttl) return cached.data;
  try {
    // Open-Meteo free endpoint (no API key). We request current weather.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(profile.latitude)}&longitude=${encodeURIComponent(profile.longitude)}&current_weather=true`;
    const res = await axios.get(url, { timeout: 6000 });
    const cw = (res.data && res.data.current_weather) || null;
    if (!cw) { weatherCache.set(key, { data: null, at: now }); return null; }
    const temperatureC = typeof cw.temperature === 'number' ? cw.temperature : (typeof cw.temperature_2m === 'number' ? cw.temperature_2m : NaN);
    const temperatureF = isNaN(temperatureC) ? NaN : cToF(temperatureC);
    const summary = typeof cw.weathercode === 'number' ? mapWeatherCode(cw.weathercode) : 'Current weather';
    const data: Weather = { summary, temperatureC, temperatureF };
    weatherCache.set(key, { data, at: now });
    return data;
  } catch {
    weatherCache.set(key, { data: null, at: now });
    return null;
  }
}

export function getDateTime(profile?: UserProfile): { iso: string; local: string } {
  const now = new Date();
  if (!profile?.timezone) return { iso: now.toISOString(), local: now.toString() };
  try {
    const local = now.toLocaleString(profile.locale || undefined, { timeZone: profile.timezone });
    return { iso: now.toISOString(), local };
  } catch {
    return { iso: now.toISOString(), local: now.toString() };
  }
}

function mapWeatherCode(code: number): string {
  // Basic mapping for Open-Meteo weathercode
  const m: Record<number, string> = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Rain showers',
    81: 'Rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with heavy hail'
  };
  return m[code] || 'Current weather';
}
