export type IntelligenceScheduleDecision = { shouldRun: boolean; reason: "scheduled" | "quiet_hours" | "weekend_interval"; easternHour: number; weekday: string };

export function intelligenceScheduleDecision(now = new Date(), cadence: "hourly" | "daily" = "hourly"): IntelligenceScheduleDecision {
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
  if (cadence === "hourly" && weekend && ![5, 9, 13, 17, 21].includes(easternHour)) return { shouldRun: false, reason: "weekend_interval", easternHour, weekday };
  return { shouldRun: true, reason: "scheduled", easternHour, weekday };
}
