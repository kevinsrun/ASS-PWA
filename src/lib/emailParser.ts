import { PlanCategory } from "@/lib/types";

export type EmailCalendarSuggestion = {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  category: PlanCategory;
  source: string;
};

function toDateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function parseDate(text: string) {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }

  const month = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i
  );
  if (!month) return null;

  const monthIndex = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].findIndex((name) => month[1].toLowerCase().startsWith(name));
  const year = Number(month[3] ?? new Date().getFullYear());

  return toDateKey(new Date(year, monthIndex, Number(month[2])));
}

function parseTime(text: string) {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const period = match[3].toLowerCase();

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function pickCategory(text: string): PlanCategory {
  const lower = text.toLowerCase();

  if (/\b(gym|run|workout|training|practice|fitness)\b/.test(lower)) {
    return "fitness";
  }
  if (/\b(class|exam|quiz|assignment|lecture|school|study)\b/.test(lower)) {
    return "school";
  }
  if (/\b(doctor|dentist|therapy|health|appointment)\b/.test(lower)) {
    return "health";
  }
  if (/\b(bill|payment|invoice|bank|finance|tax)\b/.test(lower)) {
    return "finance";
  }
  if (/\b(meeting|interview|shift|work|call|deadline)\b/.test(lower)) {
    return "work";
  }

  return "personal";
}

function cleanTitle(subject: string) {
  return subject
    .replace(/^(re|fw|fwd):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEmailCalendarSuggestion(input: {
  id: string;
  subject: string;
  snippet: string;
  internalDate?: string;
}) {
  const text = `${input.subject}\n${input.snippet}`;
  const date =
    parseDate(text) ??
    (input.internalDate
      ? toDateKey(new Date(Number(input.internalDate)))
      : toDateKey(new Date()));
  const time = parseTime(text);

  if (!time) return null;

  return {
    id: input.id,
    title: cleanTitle(input.subject) || "Email event",
    date,
    time,
    duration: 60,
    category: pickCategory(text),
    source: input.snippet,
  } satisfies EmailCalendarSuggestion;
}
