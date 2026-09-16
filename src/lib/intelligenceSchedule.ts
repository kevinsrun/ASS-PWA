export type IntelligenceScheduleDecision = { shouldRun: boolean; reason: "scheduled" | "quiet_hours" | "weekend_not_scheduled_hour"; easternHour: number; weekday: string };

export function intelligenceScheduleDecision(now = new Date()): IntelligenceScheduleDecision {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const easternHour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  if (easternHour < 5 || easternHour >= 23) return { shouldRun: false, reason: "quiet_hours", easternHour, weekday };
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (weekend && ![5, 9, 13, 17, 21].includes(easternHour)) return { shouldRun: false, reason: "weekend_not_scheduled_hour", easternHour, weekday };
  return { shouldRun: true, reason: "scheduled", easternHour, weekday };
}

export function nextIntelligenceCheck(now = new Date()) {
  const candidate = new Date(now);
  candidate.setUTCMinutes(7, 0, 0);
  if (candidate <= now) candidate.setUTCHours(candidate.getUTCHours() + 1);
  return candidate.toISOString();
}
