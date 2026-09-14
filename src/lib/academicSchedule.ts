import { addMinutesToLabel, formatTimeLabel, labelToMinutes } from "@/lib/dateTime";

const DAY_CODES: Record<string, { code: string; index: number }> = {
  m: { code: "MO", index: 1 }, mon: { code: "MO", index: 1 }, monday: { code: "MO", index: 1 },
  t: { code: "TU", index: 2 }, tu: { code: "TU", index: 2 }, tue: { code: "TU", index: 2 }, tues: { code: "TU", index: 2 }, tuesday: { code: "TU", index: 2 },
  w: { code: "WE", index: 3 }, wed: { code: "WE", index: 3 }, wednesday: { code: "WE", index: 3 },
  r: { code: "TH", index: 4 }, th: { code: "TH", index: 4 }, thu: { code: "TH", index: 4 }, thur: { code: "TH", index: 4 }, thurs: { code: "TH", index: 4 }, thursday: { code: "TH", index: 4 },
  f: { code: "FR", index: 5 }, fri: { code: "FR", index: 5 }, friday: { code: "FR", index: 5 },
  sa: { code: "SA", index: 6 }, sat: { code: "SA", index: 6 }, saturday: { code: "SA", index: 6 },
  su: { code: "SU", index: 0 }, sun: { code: "SU", index: 0 }, sunday: { code: "SU", index: 0 },
};

export type AcademicSchedule = {
  dayCodes: string[]; dayIndexes: number[]; startLabel: string; endLabel: string;
  startDate: string; endDate: string | null; recurrenceRule: string;
};

function parseDays(value: string) {
  const compact = value.toLowerCase().replace(/[^a-z/]/g, "");
  let tokens: string[] = [];
  if (/^(mwf|m\/w\/f)$/.test(compact)) tokens = ["m", "w", "f"];
  else if (/^(t\/th|tu\/th|tth|tr)$/.test(compact)) tokens = ["t", "th"];
  else {
    tokens = value.toLowerCase().match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday|thurs?|tues?|mon|wed|fri|sat|sun/g) ?? [];
  }
  const days = tokens.map((token) => DAY_CODES[token]).filter(Boolean);
  return [...new Map(days.map((day) => [day.code, day])).values()];
}

function normalizeTime(value: string, fallbackMeridiem?: string) {
  const cleaned = value.trim().replace(/\./g, "").replace(/\s+/g, " ");
  const meridiem = cleaned.match(/\b(am|pm)\b/i)?.[1] ?? fallbackMeridiem;
  const numeric = cleaned.match(/\d{1,2}(?::\d{2})?/)?.[0];
  if (!numeric) return null;
  return formatTimeLabel(`${numeric}${meridiem ? ` ${meridiem}` : ""}`);
}

function parseTimeRange(value: string, durationMinutes?: number | null) {
  const match = value.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
  if (!match) return null;
  const trailing = match[2].match(/\b(am|pm)\b/i)?.[1];
  const startLabel = normalizeTime(match[1], trailing);
  const endLabel = normalizeTime(match[2]);
  if (!startLabel) return null;
  return { startLabel, endLabel: endLabel ?? addMinutesToLabel(startLabel, durationMinutes ?? 60) };
}

function collectDates(value: unknown, output: string[]) {
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value)) output.push(date.toISOString().slice(0, 10));
  } else if (Array.isArray(value)) value.forEach((item) => collectDates(item, output));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectDates(item, output));
}

function nextDayOnOrAfter(dateKey: string, indexes: number[]) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(date.getTime() + offset * 86_400_000);
    if (indexes.includes(candidate.getUTCDay())) return candidate.toISOString().slice(0, 10);
  }
  return dateKey;
}

export function deriveAcademicSchedule(input: {
  payload?: Record<string, unknown>; description?: string | null; recurrenceRule?: string | null;
  dueAt?: string | null; durationMinutes?: number | null; structuredData?: Record<string, unknown>;
  createdAt?: string | null;
}): AcademicSchedule | null {
  const payload = input.payload ?? {};
  const combined = [payload.schedule, payload.days, payload.meetingPattern, payload.time, input.description].filter(Boolean).join(" ");
  const days = parseDays(String(payload.schedule ?? payload.days ?? payload.meetingPattern ?? combined));
  const times = parseTimeRange(String(payload.time ?? combined), input.durationMinutes);
  if (!days.length || !times) return null;
  const dates: string[] = [];
  collectDates(input.structuredData ?? {}, dates);
  const base = input.dueAt?.slice(0, 10) || input.createdAt?.slice(0, 10) || null;
  if (!base) return null;
  const startDate = nextDayOnOrAfter(base, days.map((day) => day.index));
  const futureDates = dates.filter((date) => date >= startDate).sort();
  const endDate = futureDates.at(-1) ?? null;
  const until = endDate ? `;UNTIL=${endDate.replaceAll("-", "")}T235959Z` : "";
  return {
    dayCodes: days.map((day) => day.code), dayIndexes: days.map((day) => day.index),
    startLabel: times.startLabel, endLabel: times.endLabel, startDate, endDate,
    recurrenceRule: input.recurrenceRule?.trim() || `RRULE:FREQ=WEEKLY;BYDAY=${days.map((day) => day.code).join(",")}${until}`,
  };
}

export function recurrenceMatchesDate(rule: string, date: Date) {
  const byDay = rule.toUpperCase().match(/BYDAY=([^;]+)/)?.[1]?.split(",") ?? [];
  const code = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
  const until = rule.toUpperCase().match(/UNTIL=(\d{8})/)?.[1];
  if (until && date.toISOString().slice(0, 10).replaceAll("-", "") > until) return false;
  return byDay.includes(code);
}

export function timeLabelToSql(label: string) {
  const minutes = labelToMinutes(label);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;
}
