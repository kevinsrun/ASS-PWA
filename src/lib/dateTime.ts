export function getTodayString() {
  return new Date().toISOString().split("T")[0];
}

export function formatTimeLabel(time: string) {
  const [hourStr, minuteStr = "00"] = time.split(":");
  const hour = Number(hourStr);
  const minute = minuteStr.padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minute} ${suffix}`;
}

export function addMinutesToClock(time: string, minutes: number) {
  const [hourStr, minuteStr = "00"] = time.split(":");
  const date = new Date();
  date.setHours(Number(hourStr), Number(minuteStr), 0, 0);
  date.setMinutes(date.getMinutes() + minutes);

  const hours = date.getHours().toString().padStart(2, "0");
  const mins = date.getMinutes().toString().padStart(2, "0");

  return `${hours}:${mins}`;
}

export function addMinutesToLabel(time: string, minutes: number) {
  return formatTimeLabel(addMinutesToClock(time, minutes));
}

export function clockToMinutes(time: string) {
  const [hourStr, minuteStr = "00"] = time.split(":");
  return Number(hourStr) * 60 + Number(minuteStr);
}

export function minutesToClock(minutes: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function labelToMinutes(label: string) {
  const match = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 8 * 60;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;

  return hour * 60 + minute;
}

export function parseHourFromLabel(label: string) {
  return Math.floor(labelToMinutes(label) / 60);
}
