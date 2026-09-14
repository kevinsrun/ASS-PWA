import { getServiceSupabaseClient } from "@/lib/supabaseServer";

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
  const overlapMinutes = Math.max(0, Math.floor((end - start) / 60_000));
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
  const debug = (data ?? []).map((row) => explainOverlap(proposed, {
    id: String(row.id), title: String(row.title), startAt: String(row.start_at), endAt: String(row.end_at),
    allDay: Boolean(row.all_day), hidden: Boolean(row.hidden_from_calendar), deletedAt: row.deleted_at,
    blockingStatus: row.blocking_status === "free" ? "free" : "busy", optionality: row.optionality,
  }));
  console.info(JSON.stringify({ service: "conflict-engine", proposed: proposed.title, comparisons: debug }));
  return { conflicts: debug.filter((item) => item.isActualConflict), debug };
}
