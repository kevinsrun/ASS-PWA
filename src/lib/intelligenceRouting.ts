export type IntelligenceDestination = "calendar_event" | "deadline" | "task" | "assistant_action" | "event_decision" | "email_draft" | "ignore";

export function emailDestinations(item: {
  type: string; actionRequired: boolean; confidence: number; date?: string | null;
  time?: string | null; responseNeeded?: boolean; suggestedReply?: string | null;
}) {
  if (item.type === "no_action") return ["ignore"] as IntelligenceDestination[];
  const destinations = new Set<IntelligenceDestination>(["assistant_action"]);
  if (item.responseNeeded && item.suggestedReply?.trim() && item.confidence >= 0.82) destinations.add("email_draft");
  if (!item.actionRequired || item.confidence < 0.82) return [...destinations];
  if (item.date && ["deadline", "financial_aid", "invoice", "scholarship"].includes(item.type)) {
    destinations.add("task"); destinations.add("deadline"); destinations.add("calendar_event");
  } else if (["task", "reminder", "research", "project_update"].includes(item.type)) destinations.add("task");
  if (["meeting", "interview", "travel"].includes(item.type) && item.date && item.time && item.confidence >= 0.9) destinations.add("calendar_event");
  if (["club_event", "meeting", "interview", "travel"].includes(item.type) && !destinations.has("calendar_event")) destinations.add("event_decision");
  return [...destinations];
}

export function calendarDuplicateKey(event: { title: string; start: string; end: string; location?: string | null }) {
  return [event.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), event.start, event.end, String(event.location ?? "").toLowerCase().trim()].join("|");
}
