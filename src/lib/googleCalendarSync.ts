import { randomUUID } from "crypto";
import {
  getGoogleAccessToken,
  googleConfiguration,
  readStoredGoogleToken,
} from "@/lib/googleAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { CalendarSyncState, CalendarSyncStatus } from "@/lib/types";

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  originalStartTime?: { date?: string; dateTime?: string };
};

type GoogleEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  timeZone?: string;
};

class CalendarSyncError extends Error {
  state: CalendarSyncState;

  constructor(state: CalendarSyncState, message: string) {
    super(message);
    this.name = "CalendarSyncError";
    this.state = state;
  }
}

function logSync(
  runId: string,
  stage: string,
  details: Record<string, unknown> = {}
) {
  console.info(
    JSON.stringify({ service: "google-calendar-sync", runId, stage, ...details })
  );
}

function validateTimeZone(timeZone: string | undefined) {
  const candidate = timeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

function dateParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const rawHour = Number(get("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    label: new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value)),
    minutes: hour * 60 + Number(get("minute")),
  };
}

function stableLocalId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 1_000_000_000 + (hash >>> 0);
}

function eventToPlan(event: GoogleEvent, timeZone: string) {
  if (!event.id || event.status === "cancelled" || !event.start || !event.end) {
    return null;
  }

  const instanceKey = `${event.id}:${
    event.originalStartTime?.dateTime ??
    event.originalStartTime?.date ??
    event.start.dateTime ??
    event.start.date ??
    ""
  }`;
  const allDay = Boolean(event.start.date);
  const start = event.start.dateTime
    ? dateParts(event.start.dateTime, timeZone)
    : { date: event.start.date ?? "", label: "12:00 AM", minutes: 0 };
  const end = event.end.dateTime
    ? dateParts(event.end.dateTime, timeZone)
    : { date: event.end.date ?? start.date, label: "11:59 PM", minutes: 1439 };

  if (!start.date) return null;

  return {
    user_id: "",
    local_id: stableLocalId(instanceKey),
    title: event.summary?.trim() || "Untitled event",
    date: start.date,
    start_label: start.label,
    end_label:
      !allDay && end.date !== start.date && end.minutes <= start.minutes
        ? "11:59 PM"
        : end.label,
    recurrence: "none",
    category: "other",
    priority: "medium",
    notes: [event.location, event.description].filter(Boolean).join("\n\n"),
    custom_recurrence: "",
    series_id: null,
    excluded_dates: [],
    google_event_id: instanceKey,
    source: "google",
    all_day: allDay,
    updated_at: new Date().toISOString(),
  };
}

async function setSyncState(
  userId: string,
  state: CalendarSyncState,
  values: Record<string, unknown> = {}
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase
    .from("google_tokens")
    .update({ last_sync_status: state, ...values, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) console.error("Google sync status storage failed:", error.message);
}

async function fetchEvents(userId: string, timeZone: string, runId: string) {
  let accessToken = await getGoogleAccessToken(userId);
  let pageToken = "";
  let retriedAuthorization = false;
  const events: GoogleEvent[] = [];
  const now = Date.now();
  const timeMin = new Date(now - 30 * 86_400_000).toISOString();
  const timeMax = new Date(now + 365 * 86_400_000).toISOString();

  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      maxResults: "2500",
      timeMin,
      timeMax,
      timeZone,
    });
    if (pageToken) params.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
    } catch {
      throw new CalendarSyncError(
        "unreachable",
        "Unable to reach Google Calendar. Check the network and try again."
      );
    }

    if (response.status === 401 && !retriedAuthorization) {
      logSync(runId, "access_token_rejected_refreshing");
      accessToken = await getGoogleAccessToken(userId, true);
      retriedAuthorization = true;
      continue;
    }

    const body = (await response.json().catch(() => ({}))) as
      | GoogleEventsResponse
      | { error?: { message?: string } };
    if (!response.ok) {
      const message =
        "error" in body && body.error?.message
          ? body.error.message
          : `Google Calendar returned HTTP ${response.status}`;
      throw new CalendarSyncError(
        response.status === 401 || response.status === 403 ? "auth_expired" : "error",
        message
      );
    }

    const page = body as GoogleEventsResponse;
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
    logSync(runId, "google_page_received", {
      pageEvents: page.items?.length ?? 0,
      hasNextPage: Boolean(pageToken),
    });
  } while (pageToken);

  return events;
}

export async function getCalendarSyncStatus(
  userId: string
): Promise<CalendarSyncStatus> {
  const config = googleConfiguration();
  if (!config.ready) {
    return {
      state: "misconfigured",
      connected: false,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      error: `Missing server configuration: ${config.missing.join(", ")}`,
      timeZone: null,
    };
  }

  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data, error } = await supabase
    .from("google_tokens")
    .select(
      "last_sync_status,last_sync_error,last_successful_sync_at,last_sync_attempt_at,calendar_time_zone"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return {
      state: "misconfigured",
      connected: false,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      error: `Calendar sync database migration is missing: ${error.message}`,
      timeZone: null,
    };
  }
  if (!data) {
    return {
      state: "not_connected",
      connected: false,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      error: null,
      timeZone: null,
    };
  }
  return {
    state: (data.last_sync_status as CalendarSyncState) || "ready",
    connected: true,
    lastSuccessfulSyncAt: data.last_successful_sync_at
      ? String(data.last_successful_sync_at)
      : null,
    lastAttemptAt: data.last_sync_attempt_at
      ? String(data.last_sync_attempt_at)
      : null,
    error: data.last_sync_error ? String(data.last_sync_error) : null,
    timeZone: data.calendar_time_zone ? String(data.calendar_time_zone) : null,
  };
}

export async function syncGoogleCalendarForUser(
  userId: string,
  requestedTimeZone?: string
): Promise<CalendarSyncStatus> {
  const runId = randomUUID();
  const timeZone = validateTimeZone(requestedTimeZone);
  const attemptedAt = new Date().toISOString();
  const previousStatus = await getCalendarSyncStatus(userId).catch(() => null);
  logSync(runId, "started", { user: userId.slice(0, 8), timeZone });

  try {
    const token = await readStoredGoogleToken(userId);
    if (!token) throw new CalendarSyncError("not_connected", "Google Calendar is not connected.");
    await setSyncState(userId, "syncing", {
      last_sync_attempt_at: attemptedAt,
      last_sync_error: null,
      calendar_time_zone: timeZone,
    });

    const events = await fetchEvents(userId, timeZone, runId);
    const rows = events
      .map((event) => eventToPlan(event, timeZone))
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => ({ ...row, user_id: userId }));
    logSync(runId, "events_mapped", { received: events.length, mapped: rows.length });

    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new CalendarSyncError("misconfigured", "A Supabase server key is not configured");

    const { data: existing, error: existingError } = await supabase
      .from("plans")
      .select("local_id,google_event_id")
      .eq("user_id", userId)
      .eq("source", "google");
    if (existingError) throw new CalendarSyncError("error", `Unable to read synced plans: ${existingError.message}`);

    if (rows.length > 0) {
      const { error } = await supabase.from("plans").upsert(rows, {
        onConflict: "user_id,local_id",
      });
      if (error) throw new CalendarSyncError("error", `Unable to save calendar events: ${error.message}`);
    }

    const currentIds = new Set(rows.map((row) => row.google_event_id));
    const staleIds = (existing ?? [])
      .filter((row) => row.google_event_id && !currentIds.has(String(row.google_event_id)))
      .map((row) => Number(row.local_id));
    for (let index = 0; index < staleIds.length; index += 100) {
      const { error } = await supabase
        .from("plans")
        .delete()
        .eq("user_id", userId)
        .in("local_id", staleIds.slice(index, index + 100));
      if (error) throw new CalendarSyncError("error", `Unable to remove deleted events: ${error.message}`);
    }

    const completedAt = new Date().toISOString();
    await setSyncState(userId, "synced", {
      last_successful_sync_at: completedAt,
      last_sync_attempt_at: attemptedAt,
      last_sync_error: null,
      calendar_time_zone: timeZone,
    });
    logSync(runId, "completed", { imported: rows.length, removed: staleIds.length });
    return {
      state: "synced",
      connected: true,
      lastSuccessfulSyncAt: completedAt,
      lastAttemptAt: attemptedAt,
      error: null,
      timeZone,
      eventsImported: rows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown calendar sync failure";
    const state =
      error instanceof CalendarSyncError
        ? error.state
        : /refresh token|invalid_grant|authorization expired/i.test(message)
          ? "auth_expired"
          : /not configured|migration is missing/i.test(message)
            ? "misconfigured"
            : "error";
    console.error(JSON.stringify({ service: "google-calendar-sync", runId, stage: "failed", state, message }));
    await setSyncState(userId, state, {
      last_sync_attempt_at: attemptedAt,
      last_sync_error: message,
      calendar_time_zone: timeZone,
    });
    return {
      state,
      connected: state !== "not_connected",
      lastSuccessfulSyncAt: previousStatus?.lastSuccessfulSyncAt ?? null,
      lastAttemptAt: attemptedAt,
      error: message,
      timeZone,
    };
  }
}
