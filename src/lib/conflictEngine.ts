import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { calendarLocalIso } from "@/lib/academicSchedule";
import { isPlanVisibleOnDate } from "@/lib/calendarRecurrence";
import type { SavedPlan } from "@/lib/types";
import { labelToMinutes } from "@/lib/dateTime";

export type ConflictEvent = {
  id: string; title: string; startAt: string; endAt: string; allDay?: boolean;
  hidden?: boolean; deletedAt?: string | null; blockingStatus?: "busy" | "free";
  optionality?: "required" | "recommended" | "optional" | "tentative" | "unknown";
  kind?: string | null;
};

export type ConflictDebug = {
  eventA: string; eventAStart: string; eventAEnd: string;
  eventB: string; eventBStart: string; eventBEnd: string;
  overlapMinutes: number; blockingStatus: "busy" | "free";
  isActualConflict: boolean; reason: string;
};

function blocks(event: ConflictEvent) {
  if (event.hidden || event.deletedAt) return false;
  if (event.blockingStatus === "free") return false;
  if (event.allDay) return false;
  if (["deadline", "reminder"].includes(event.kind ?? "")) return false;
  if (["optional", "tentative"].includes(event.optionality ?? "unknown")) return false;
  return true;
}

export function explainOverlap(a: ConflictEvent, b: ConflictEvent): ConflictDebug {
  const start = Math.max(new Date(a.startAt).getTime(), new Date(b.startAt).getTime());
  const end = Math.min(new Date(a.endAt).getTime(), new Date(b.endAt).getTime());
  const overlapMinutes = Math.max(0, (end - start) / 60_000);
  const blocking = blocks(a) && blocks(b);
  const distinct = a.id !== b.id;
  const isActualConflict = distinct && blocking && overlapMinutes > 0;
  const reason = !distinct ? "same canonical event" : overlapMinutes <= 0 ? "times do not overlap" : !blocking ? "one event is non-blocking" : "distinct busy commitments overlap";
  return { eventA: a.title, eventAStart: a.startAt, eventAEnd: a.endAt, eventB: b.title, eventBStart: b.startAt, eventBEnd: b.endAt, overlapMinutes, blockingStatus: blocking ? "busy" : "free", isActualConflict, reason };
}

export async function conflictsForInterval(userId: string, proposed: ConflictEvent) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase.from("canonical_events")
    .select("id,title,start_at,end_at,all_day,hidden_from_calendar,deleted_at,blocking_status,optionality")
    .eq("user_id", userId).is("deleted_at", null).eq("hidden_from_calendar", false)
    .lt("start_at", proposed.endAt).gt("end_at", proposed.startAt);
  if (error) throw error;
  // Local recurring classes are stored once, unlike Google's expanded instances.
  // Compare the occurrences the calendar actually displays, not only the seed date.
  const { data: recurringPlans, error: recurringError } = await supabase.from("plans")
    .select("*").eq("user_id", userId).or("recurrence.neq.none,canonical_event_id.is.null").limit(1000);
  if (recurringError) throw recurringError;
  if ((recurringPlans?.length ?? 0) >= 1000 || (data?.length ?? 0) >= 1000) throw new Error("Too many events to safely validate this interval.");
  const recurringIds = [...new Set((recurringPlans ?? []).map((plan) => plan.canonical_event_id).filter(Boolean))];
  const recurringEvents = recurringIds.length ? await supabase.from("canonical_events").select("*")
    .eq("user_id", userId).in("id", recurringIds).is("deleted_at", null).eq("hidden_from_calendar", false) : { data: [], error: null };
  if (recurringEvents.error) throw recurringEvents.error;
  const storedEvents = [...(recurringEvents.data ?? [])];
  for (const row of recurringPlans ?? []) {
    if (row.canonical_event_id) continue;
    const zone = row.time_zone || "America/New_York";
    const overnight = labelToMinutes(row.end_label) <= labelToMinutes(row.start_label);
    const endDate = new Date(new Date(`${row.date}T12:00:00Z`).getTime() + (overnight ? 86_400_000 : 0)).toISOString().slice(0, 10);
    storedEvents.push({ id: `plan:${row.local_id}`, title: row.title, start_at: calendarLocalIso(row.date, row.start_label, zone), end_at: calendarLocalIso(endDate, row.end_label, zone), time_zone: zone, all_day: row.all_day, blocking_status: row.blocking_status, optionality: row.optionality });
  }
  const comparisons: ConflictEvent[] = [];
  for (const event of storedEvents) {
    const row = (recurringPlans ?? []).find((plan) => plan.canonical_event_id === event.id || (!plan.canonical_event_id && `plan:${plan.local_id}` === event.id));
    if (!row) continue;
    const zone = event.time_zone || "America/New_York";
    const localDate = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: zone });
    const first = new Date(`${localDate(proposed.startAt)}T12:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 1); // Overnight commitments may start yesterday.
    const last = new Date(`${localDate(proposed.endAt)}T12:00:00Z`);
    if (last.getTime() - first.getTime() > 31 * 86_400_000) throw new Error("Schedule actions must cover at most 31 days.");
    const plan: SavedPlan = { id: Number(row.local_id), title: row.title, date: row.date, startLabel: row.start_label, endLabel: row.end_label, recurrence: row.recurrence, customRecurrence: row.custom_recurrence || event.recurrence_rule || "", excludedDates: row.excluded_dates ?? [] };
    const seedStartDate = localDate(event.start_at);
    const seedEndDate = localDate(event.end_at);
    const endDayOffset = Math.max(0, Math.round((new Date(`${seedEndDate}T12:00:00Z`).getTime() - new Date(`${seedStartDate}T12:00:00Z`).getTime()) / 86_400_000));
    for (let day = first; day <= last; day = new Date(day.getTime() + 86_400_000)) {
      const dateKey = day.toISOString().slice(0, 10);
      if (!isPlanVisibleOnDate(plan, dateKey)) continue;
      const endDate = new Date(day.getTime() + endDayOffset * 86_400_000).toISOString().slice(0, 10);
      comparisons.push({ id: String(event.id), title: event.title, startAt: calendarLocalIso(dateKey, plan.startLabel, zone), endAt: calendarLocalIso(endDate, plan.endLabel, zone), allDay: event.all_day, hidden: event.hidden_from_calendar, deletedAt: event.deleted_at, blockingStatus: event.blocking_status, optionality: event.optionality });
    }
  }
  const debug = (data ?? []).filter((row) => !recurringIds.includes(row.id)).map((row) => explainOverlap(proposed, {
    id: String(row.id), title: String(row.title), startAt: String(row.start_at), endAt: String(row.end_at),
    allDay: Boolean(row.all_day), hidden: Boolean(row.hidden_from_calendar), deletedAt: row.deleted_at,
    blockingStatus: row.blocking_status === "free" ? "free" : "busy", optionality: row.optionality,
  }));
  for (const event of comparisons) {
    const comparison = explainOverlap(proposed, event);
    debug.push(comparison);
  }
  console.info(JSON.stringify({ service: "conflict-engine", proposed: proposed.title, comparisons: debug }));
  return { conflicts: debug.filter((item) => item.isActualConflict), debug };
}
