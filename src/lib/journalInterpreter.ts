export type JournalSuggestion = {
  type: "todo" | "habit" | "plan";
  title: string;
  time?: string | null;
  duration?: number;
  recurrence?: "none" | "daily" | "weekly" | null;
};

export function interpretJournal(text: string): JournalSuggestion[] {
  const suggestions: JournalSuggestion[] = [];

  const lines = text
    .split(/[.\n]/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();
    const time = extractTime(line);
    const recurrence = hasDailyRecurrence(line) ? "daily" : null;

    if (time && recurrence === "daily") {
      suggestions.push({
        type: "plan",
        title: cleanLine(line),
        time,
        recurrence,
      });
    }

    if (
      lower.includes("need to") ||
      lower.includes("have to") ||
      lower.includes("should") ||
      lower.includes("deadline") ||
      lower.includes("finish")
    ) {
      suggestions.push({
        type: "todo",
        title: cleanLine(line),
      });
    }

    if (recurrence === "daily") {
      suggestions.push({
        type: "habit",
        title: cleanLine(line),
        recurrence,
      });
    }
  }

  return suggestions;
}

function extractTime(text: string): string | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const period = match[3].toLowerCase();

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function hasDailyRecurrence(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("every day") ||
    lower.includes("daily") ||
    lower.includes("every morning") ||
    lower.includes("every night")
  );
}

function cleanLine(line: string) {
  return line
    .replace(/^i\s+/i, "")
    .replace(/^(need to|have to|should|want to)\s+/i, "")
    .trim();
}