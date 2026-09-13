import { getServiceSupabaseClient } from "@/lib/supabaseServer";

type ForecastPeriod = { startTime: string; temperature: number; probabilityOfPrecipitation?: { value?: number | null }; windSpeed?: string; shortForecast: string };
const outdoorWords = /\b(outdoor|outside|walk|run|hike|picnic|field|park|travel|flight|bike|cycling|game|practice)\b/i;

export async function weatherDecisionContext(userId: string, event: { title: string; date: string | null; time: string | null; location?: string | null }) {
  if (!event.date || !outdoorWords.test(`${event.title} ${event.location ?? ""}`)) return null;
  const target = new Date(`${event.date}T${event.time || "12:00"}:00-04:00`);
  if (Number.isNaN(target.getTime()) || target.getTime() < Date.now() - 3_600_000 || target.getTime() > Date.now() + 7 * 86_400_000) return null;
  const latitude = Number(process.env.ASS_WEATHER_LAT ?? 41.8268);
  const longitude = Number(process.env.ASS_WEATHER_LON ?? -71.4025);
  const agent = process.env.ASS_WEATHER_USER_AGENT?.trim() || "ASS-PWA/1.0 (developer@localhost)";
  const headers = { "User-Agent": agent, Accept: "application/geo+json" };
  const point = await fetch(`https://api.weather.gov/points/${latitude},${longitude}`, { headers, next: { revalidate: 21600 } });
  if (!point.ok) throw new Error(`Weather service returned HTTP ${point.status}`);
  const pointBody = await point.json() as { properties?: { forecastHourly?: string } };
  if (!pointBody.properties?.forecastHourly) return null;
  const response = await fetch(pointBody.properties.forecastHourly, { headers, next: { revalidate: 1800 } });
  if (!response.ok) throw new Error(`Weather forecast returned HTTP ${response.status}`);
  const body = await response.json() as { properties?: { periods?: ForecastPeriod[] } };
  const period = (body.properties?.periods ?? []).reduce<ForecastPeriod | null>((best, candidate) => !best || Math.abs(new Date(candidate.startTime).getTime() - target.getTime()) < Math.abs(new Date(best.startTime).getTime() - target.getTime()) ? candidate : best, null);
  if (!period) return null;
  const precipitation = Number(period.probabilityOfPrecipitation?.value ?? 0);
  const adverse = /thunder|storm|snow|sleet|freez|heavy rain/i.test(period.shortForecast);
  const riskLevel = adverse || precipitation >= 70 ? "high" : precipitation >= 40 ? "medium" : "low";
  const supabase = getServiceSupabaseClient();
  await supabase?.from("weather_snapshots").insert({ user_id: userId, latitude, longitude, forecast_at: period.startTime, temperature_f: period.temperature, precipitation_probability: precipitation, wind_mph: Number(period.windSpeed?.match(/\d+/)?.[0] ?? 0), short_forecast: period.shortForecast, risk_level: riskLevel, raw_data: period });
  if (riskLevel === "low") return null;
  return `${riskLevel === "high" ? "Weather may change this plan" : "Check the weather"}: ${period.shortForecast}, ${period.temperature}°F, ${precipitation}% precipitation near the event time.`;
}
