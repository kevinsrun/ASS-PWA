import { recurrenceMatchesDate } from "@/lib/academicSchedule";
import type { SavedPlan } from "@/lib/types";

export function isPlanVisibleOnDate(plan: SavedPlan, dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const planDate = new Date(`${plan.date}T12:00:00Z`);
  const custom = (plan.customRecurrence ?? "").toLowerCase();
  if (plan.excludedDates?.includes(dateKey) || plan.date > dateKey) return false;
  if (plan.date === dateKey) return true;
  if (plan.recurrence === "daily") return true;
  if (plan.recurrence === "weekdays") return date.getUTCDay() > 0 && date.getUTCDay() < 6;
  if (plan.recurrence === "weekends") return [0, 6].includes(date.getUTCDay());
  if (plan.recurrence === "weekly") return planDate.getUTCDay() === date.getUTCDay();
  if (plan.recurrence !== "custom") return false;
  if (/RRULE:/i.test(custom)) return recurrenceMatchesDate(custom, date);
  const daysSinceStart = Math.floor((date.getTime() - planDate.getTime()) / 86_400_000);
  if (custom.includes("every other day") || custom.includes("every 2 days")) return daysSinceStart % 2 === 0;
  const intervalMatch = custom.match(/every\s+(\d+)\s+days?/);
  if (intervalMatch) return Number(intervalMatch[1]) > 0 && daysSinceStart % Number(intervalMatch[1]) === 0;
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return dayNames.some((day, index) => custom.includes(day) && index === date.getUTCDay());
}
