import { createHash } from "crypto";
import { labelToMinutes } from "@/lib/dateTime";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export type CanonicalGoogleEvent = {
  id: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  location?: string;
  etag?: string;
  status?: string;
  updated?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
};

type PlanProjection = Record<string, unknown> & {
  title: string;
  date: string;
  start_label: string;
  end_label: string;
  all_day: boolean;
  google_color?: string | null;
};

function normalized(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value?: string | null) {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 1));
}

function similarity(left?: string | null, right?: string | null) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function eventInstant(part: CanonicalGoogleEvent["start"], end = false) {
  if (part.dateTime) return new Date(part.dateTime).toISOString();
  const date = part.date ?? new Date().toISOString().slice(0, 10);
  return new Date(`${date}T${end ? "23:59:59" : "00:00:00"}Z`).toISOString();
}

function attendeeEmails(event: CanonicalGoogleEvent) {
  return (event.attendees ?? [])
    .map((attendee) => attendee.email?.toLowerCase().trim())
    .filter((email): email is string => Boolean(email))
    .sort();
}

export function canonicalEventFingerprint(event: CanonicalGoogleEvent) {
  const payload = [
    normalized(event.summary),
    eventInstant(event.start).slice(0, 16),
    eventInstant(event.end, true).slice(0, 16),
    normalized(event.location),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function canonicalPlanLocalId(value: string) {
  const digest = createHash("sha256").update(value).digest();
  return 1_000_000_000 + digest.readUInt32BE(0);
}

function candidateScore(
  event: CanonicalGoogleEvent,
  candidate: Record<string, unknown>
) {
  const startDelta = Math.abs(new Date(eventInstant(event.start)).getTime() - new Date(String(candidate.start_at)).getTime());
  const endDelta = Math.abs(new Date(eventInstant(event.end, true)).getTime() - new Date(String(candidate.end_at)).getTime());
  if (startDelta > 5 * 60_000 || endDelta > 10 * 60_000) return 0;
  const title = similarity(event.summary, String(candidate.title ?? ""));
  if (title < 0.62) return 0;
  let score = 0.5 + title * 0.34;
  let weight = 0.84;
  if (event.location && candidate.location) {
    score += similarity(event.location, String(candidate.location)) * 0.06;
    weight += 0.06;
  }
  if (event.description && candidate.description) {
    score += similarity(event.description, String(candidate.description)) * 0.05;
    weight += 0.05;
  }
  const organizer = event.organizer?.email?.toLowerCase();
  if (organizer && candidate.organizer_email) {
    score += organizer === String(candidate.organizer_email).toLowerCase() ? 0.06 : 0;
    weight += 0.06;
  }
  const sourceAttendees = new Set(attendeeEmails(event));
  const candidateAttendees = new Set(
    Array.isArray(candidate.attendee_emails) ? candidate.attendee_emails.map(String) : []
  );
  if (sourceAttendees.size && candidateAttendees.size) {
    let shared = 0;
    for (const email of sourceAttendees) if (candidateAttendees.has(email)) shared += 1;
    score += (shared / Math.max(sourceAttendees.size, candidateAttendees.size)) * 0.04;
    weight += 0.04;
  }
  return score / weight;
}

async function writeAlert(
  userId: string,
  values: { dedupeKey: string; kind: string; severity?: string; title: string; summary: string; recommendation?: string }
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.from("assistant_alerts").upsert({
    user_id: userId,
    dedupe_key: values.dedupeKey,
    kind: values.kind,
    severity: values.severity ?? "normal",
    title: values.title,
    summary: values.summary,
    recommendation: values.recommendation ?? null,
    status: "pending",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,dedupe_key" });
  if (error) console.error(JSON.stringify({ service: "assistant-alerts", stage: "store_failed", message: error.message }));
}

export async function recordSyncError(values: {
  userId: string;
  accountId?: string;
  calendarId?: string;
  service: string;
  code?: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return;
  await supabase.from("sync_errors").insert({
    user_id: values.userId,
    connected_account_id: values.accountId ?? null,
    calendar_id: values.calendarId ?? null,
    service: values.service,
    error_code: values.code ?? null,
    message: values.message,
    context: values.context ?? {},
  });
}

export async function upsertCanonicalEvent(values: {
  userId: string;
  accountId: string;
  calendarId: string;
  event: CanonicalGoogleEvent;
  plan: PlanProjection;
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { userId, accountId, calendarId, event, plan } = values;
  const startAt = eventInstant(event.start);
  const endAt = eventInstant(event.end, true);
  const attendees = attendeeEmails(event);
  const eventFingerprint = canonicalEventFingerprint(event);

  const { data: existingSource, error: sourceReadError } = await supabase
    .from("calendar_event_sources")
    .select("canonical_event_id,etag,deleted_at,ignore_future_imports")
    .eq("google_account_id", accountId)
    .eq("calendar_id", calendarId)
    .eq("google_event_id", event.id)
    .maybeSingle();
  if (sourceReadError) throw sourceReadError;
  if (existingSource?.ignore_future_imports) {
    console.info(JSON.stringify({ service: "calendar-canonical", stage: "suppressed-by-tombstone", accountId, calendarId, googleEventId: event.id }));
    return { canonicalId: String(existingSource.canonical_event_id), duplicateMerged: false, suppressed: true };
  }

  let canonicalId = existingSource?.canonical_event_id
    ? String(existingSource.canonical_event_id)
    : null;
  let duplicateMerged = false;
  if (canonicalId && existingSource?.etag && event.etag && String(existingSource.etag) === String(event.etag) && !existingSource.deleted_at) {
    return { canonicalId, duplicateMerged: false };
  }
  if (!canonicalId) {
    const { data: sameGoogleEvent, error: sameEventError } = await supabase
      .from("calendar_event_sources")
      .select("canonical_event_id")
      .eq("user_id", userId)
      .eq("google_event_id", event.id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (sameEventError) throw sameEventError;
    if (sameGoogleEvent?.canonical_event_id) {
      canonicalId = String(sameGoogleEvent.canonical_event_id);
      duplicateMerged = true;
    }
  }
  if (!canonicalId) {
    const lower = new Date(new Date(startAt).getTime() - 5 * 60_000).toISOString();
    const upper = new Date(new Date(startAt).getTime() + 5 * 60_000).toISOString();
    const { data: candidates, error } = await supabase
      .from("canonical_events")
      .select("id,title,description,start_at,end_at,location,organizer_email,attendee_emails,recurring_key")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("hidden_from_calendar", false)
      .gte("start_at", lower)
      .lte("start_at", upper)
      .limit(30);
    if (error) throw error;
    const recurringKey = event.recurringEventId ?? null;
    const match = (candidates ?? [])
      .map((candidate) => ({ candidate, score: candidateScore(event, candidate) }))
      .sort((a, b) => b.score - a.score)
      .find(({ candidate, score }) =>
        score >= 0.78 || (recurringKey && candidate.recurring_key === recurringKey && score >= 0.68)
      );
    if (match) {
      canonicalId = String(match.candidate.id);
      duplicateMerged = true;
    }
  }

  const canonicalRow = {
    user_id: userId,
    fingerprint: eventFingerprint,
    title: plan.title,
    start_at: startAt,
    end_at: endAt,
    all_day: plan.all_day,
    time_zone: event.start.timeZone ?? "UTC",
    location: event.location ?? null,
    description: event.description ?? null,
    organizer_email: event.organizer?.email ?? null,
    attendee_emails: attendees,
    recurring_key: event.recurringEventId ?? null,
    color: plan.google_color ?? null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (canonicalId) {
    const { error } = await supabase.from("canonical_events").update(canonicalRow).eq("id", canonicalId).eq("user_id", userId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("canonical_events").upsert(canonicalRow, {
      onConflict: "user_id,fingerprint",
    }).select("id").single();
    if (error) throw error;
    canonicalId = String(data.id);
  }

  const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  const { error: sourceError } = await supabase.from("calendar_event_sources").upsert({
    user_id: userId,
    canonical_event_id: canonicalId,
    google_account_id: accountId,
    calendar_id: calendarId,
    google_event_id: event.id,
    recurring_event_id: event.recurringEventId ?? null,
    organizer_email: event.organizer?.email ?? null,
    attendee_emails: attendees,
    etag: event.etag ?? null,
    payload_hash: payloadHash,
    deleted_at: null,
    source_deleted: false,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "google_account_id,calendar_id,google_event_id" });
  if (sourceError) throw sourceError;

  const { count, error: countError } = await supabase
    .from("calendar_event_sources")
    .select("id", { count: "exact", head: true })
    .eq("canonical_event_id", canonicalId)
    .is("deleted_at", null);
  if (countError) throw countError;
  await supabase.from("canonical_events").update({ source_count: count ?? 1 }).eq("id", canonicalId);

  const { error: planError } = await supabase.from("plans").upsert({
    ...plan,
    user_id: userId,
    local_id: canonicalPlanLocalId(canonicalId),
    canonical_event_id: canonicalId,
  }, { onConflict: "user_id,canonical_event_id" });
  if (planError) throw planError;

  return { canonicalId, duplicateMerged, suppressed: false };
}

export async function removeCanonicalSources(values: {
  userId: string;
  accountId: string;
  calendarId: string;
  eventIds: string[];
}) {
  if (values.eventIds.length === 0) return 0;
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: sources, error } = await supabase
    .from("calendar_event_sources")
    .select("id,canonical_event_id")
    .eq("user_id", values.userId)
    .eq("google_account_id", values.accountId)
    .eq("calendar_id", values.calendarId)
    .in("google_event_id", values.eventIds);
  if (error) throw error;
  const now = new Date().toISOString();
  if ((sources ?? []).length) {
    const { error: updateError } = await supabase
      .from("calendar_event_sources")
      .update({ deleted_at: now, updated_at: now })
      .in("id", (sources ?? []).map((source) => source.id));
    if (updateError) throw updateError;
  }
  for (const canonicalId of new Set((sources ?? []).map((source) => String(source.canonical_event_id)))) {
    const { count } = await supabase.from("calendar_event_sources").select("id", { count: "exact", head: true }).eq("canonical_event_id", canonicalId).is("deleted_at", null);
    if (!count) {
      await supabase.from("plans").delete().eq("user_id", values.userId).eq("canonical_event_id", canonicalId);
      await supabase.from("canonical_events").delete().eq("user_id", values.userId).eq("id", canonicalId);
    } else {
      await supabase.from("canonical_events").update({ source_count: count }).eq("id", canonicalId);
    }
  }
  return (sources ?? []).length;
}

export async function reconcileCalendarSources(values: {
  userId: string;
  accountId: string;
  calendarId: string;
  activeEventIds: string[];
}) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase
    .from("calendar_event_sources")
    .select("google_event_id")
    .eq("user_id", values.userId)
    .eq("google_account_id", values.accountId)
    .eq("calendar_id", values.calendarId)
    .is("deleted_at", null);
  if (error) throw error;
  const active = new Set(values.activeEventIds);
  const stale = (data ?? []).map((row) => String(row.google_event_id)).filter((id) => !active.has(id));
  return removeCanonicalSources({ ...values, eventIds: stale });
}

function conflictSeverity(left: Record<string, unknown>, right: Record<string, unknown>) {
  const text = `${left.title ?? ""} ${right.title ?? ""}`.toLowerCase();
  if (/class|lecture|exam|interview|deadline|doctor|research/.test(text)) return "high";
  if (/study|club|meeting|office hour/.test(text)) return "medium";
  return "low";
}

export async function detectCalendarConflicts(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return 0;
  const { error: staleAlertError } = await supabase.from("assistant_alerts")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", "calendar_conflict")
    .eq("status", "pending");
  if (staleAlertError) throw staleAlertError;
  const today = new Date().toISOString().slice(0, 10);
  const through = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("plans")
    .select("id,local_id,canonical_event_id,title,date,start_label,end_label,all_day,category,priority")
    .eq("user_id", userId)
    .eq("all_day", false)
    .gte("date", today)
    .lte("date", through)
    .order("date")
    .order("start_label");
  if (error) throw error;
  let conflicts = 0;
  const events = data ?? [];
  for (let leftIndex = 0; leftIndex < events.length; leftIndex += 1) {
    const left = events[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < events.length; rightIndex += 1) {
      const right = events[rightIndex];
      if (String(right.date) !== String(left.date)) break;
      if (labelToMinutes(String(right.start_label)) >= labelToMinutes(String(left.end_label))) break;
      const leftKey = String(left.canonical_event_id ?? left.local_id ?? left.id);
      const rightKey = String(right.canonical_event_id ?? right.local_id ?? right.id);
      if (leftKey === rightKey) continue;
      const severity = conflictSeverity(left, right);
      const key = [leftKey, rightKey].sort().join(":");
      await writeAlert(userId, {
        dedupeKey: `calendar-conflict:${key}`,
        kind: "calendar_conflict",
        severity,
        title: `${left.title} conflicts with ${right.title}`,
        summary: `${left.title} (${left.start_label}–${left.end_label}) overlaps ${right.title} (${right.start_label}–${right.end_label}) on ${left.date}.`,
        recommendation: severity === "high"
          ? "Protect the fixed academic or professional commitment and reschedule the more flexible event."
          : "Move the more flexible block to the next open time without changing its deadline.",
      });
      conflicts += 1;
    }
  }
  return conflicts;
}
