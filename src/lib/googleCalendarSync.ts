import { randomUUID } from "crypto";
import {
  getGoogleAccessToken,
  googleConfiguration,
  listGoogleAccounts,
  readStoredGoogleToken,
} from "@/lib/googleAuth";
import { labelToMinutes } from "@/lib/dateTime";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import {
  detectCalendarConflicts,
  reconcileCalendarSources,
  recordSyncError,
  removeCanonicalSources,
  upsertCanonicalEvent,
  type CanonicalGoogleEvent,
} from "@/lib/calendarCanonical";
import type {
  CalendarSyncState,
  CalendarSyncStatus,
  GoogleCalendarSummary,
  SavedPlan,
} from "@/lib/types";

type GoogleCalendar = {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
};

type GoogleEvent = Partial<CanonicalGoogleEvent> & {
  colorId?: string;
  recurrence?: string[];
};

type GoogleListResponse<T> = {
  items?: T[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type GoogleColorsResponse = {
  event?: Record<string, { background?: string; foreground?: string }>;
};

type StoredCalendar = {
  google_account_id: string;
  calendar_id: string;
  summary: string;
  time_zone: string | null;
  background_color: string | null;
  foreground_color: string | null;
  access_role: string;
  is_primary: boolean;
  is_selected: boolean;
  is_hidden: boolean;
  sync_token: string | null;
};

class CalendarSyncError extends Error {
  state: CalendarSyncState;
  status?: number;

  constructor(state: CalendarSyncState, message: string, status?: number) {
    super(message);
    this.name = "CalendarSyncError";
    this.state = state;
    this.status = status;
  }
}

function logSync(runId: string, stage: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ service: "google-calendar-sync", runId, stage, ...details }));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
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

function eventToPlan(
  event: GoogleEvent,
  calendar: Pick<StoredCalendar, "google_account_id" | "calendar_id" | "time_zone" | "background_color">
) {
  if (!event.id || event.status === "cancelled" || !event.start || !event.end) return null;
  const timeZone = validateTimeZone(event.start.timeZone ?? calendar.time_zone ?? undefined);
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
    local_id: stableLocalId(`${calendar.google_account_id}:${calendar.calendar_id}:${event.id}`),
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
    custom_recurrence: event.recurrence?.join("\n") ?? "",
    series_id: event.recurringEventId ?? null,
    excluded_dates: [],
    google_account_id: calendar.google_account_id,
    google_event_id: event.id,
    google_calendar_id: calendar.calendar_id,
    google_recurring_event_id: event.recurringEventId ?? null,
    google_color: calendar.background_color,
    google_etag: event.etag ?? null,
    google_updated_at: event.updated ?? null,
    source: "google",
    all_day: allDay,
    updated_at: new Date().toISOString(),
  };
}

async function setSyncState(
  userId: string,
  accountId: string,
  state: CalendarSyncState,
  values: Record<string, unknown> = {}
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase
    .from("google_tokens")
    .update({ last_sync_status: state, ...values, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", accountId);
  if (error) {
    console.error(JSON.stringify({
      service: "google-calendar-sync",
      stage: "status_store_failed",
      message: error.message,
    }));
  }
  await supabase.from("connected_accounts").update({
    sync_status: state,
    last_successful_sync_at: values.last_successful_sync_at ?? undefined,
    last_sync_error: values.last_sync_error ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", accountId).eq("user_id", userId);
}

async function googleRequest<T>(
  userId: string,
  accountId: string,
  url: string,
  init: RequestInit = {},
  forceRefresh = false
): Promise<{ response: Response; body: T }> {
  const accessToken = await getGoogleAccessToken(userId, accountId, forceRefresh);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new CalendarSyncError(
      "unreachable",
      "Unable to reach Google Calendar. Check the network and try again."
    );
  }
  if (response.status === 401 && !forceRefresh) {
    return googleRequest<T>(userId, accountId, url, init, true);
  }
  const body = response.status === 204
    ? ({} as T)
    : ((await response.json().catch(() => ({}))) as T);
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } };
    throw new CalendarSyncError(
      response.status === 401 || response.status === 403 ? "auth_expired" : "error",
      errorBody.error?.message ?? `Google Calendar returned HTTP ${response.status}`,
      response.status
    );
  }
  return { response, body };
}

async function fetchCalendars(userId: string, accountId: string) {
  const calendars: GoogleCalendar[] = [];
  let pageToken = "";
  let listSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250", showHidden: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const { body } = await googleRequest<GoogleListResponse<GoogleCalendar>>(
      userId,
      accountId,
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`
    );
    calendars.push(
      ...(body.items ?? []).filter(
        (calendar) => calendar.id && calendar.accessRole !== "none"
      )
    );
    pageToken = body.nextPageToken ?? "";
    listSyncToken = body.nextSyncToken ?? listSyncToken;
  } while (pageToken);
  return { calendars, listSyncToken };
}

async function fetchEventColors(userId: string, accountId: string) {
  const { body } = await googleRequest<GoogleColorsResponse>(
    userId,
    accountId,
    "https://www.googleapis.com/calendar/v3/colors"
  );
  return body.event ?? {};
}

async function fetchCalendarEvents(
  userId: string,
  accountId: string,
  calendar: StoredCalendar,
  timeZone: string,
  runId: string,
  forceFull = false
) {
  const incremental = Boolean(calendar.sync_token && !forceFull);
  const events: GoogleEvent[] = [];
  let pageToken = "";
  let nextSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "2500",
      timeZone,
    });
    if (incremental) {
      params.set("syncToken", calendar.sync_token!);
    } else {
      const now = Date.now();
      params.set("timeMin", new Date(now - 365 * 86_400_000).toISOString());
      params.set("timeMax", new Date(now + 730 * 86_400_000).toISOString());
    }
    if (pageToken) params.set("pageToken", pageToken);

    try {
      const { body } = await googleRequest<GoogleListResponse<GoogleEvent>>(
        userId,
        accountId,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendar_id)}/events?${params}`
      );
      events.push(...(body.items ?? []));
      pageToken = body.nextPageToken ?? "";
      nextSyncToken = body.nextSyncToken ?? nextSyncToken;
    } catch (error) {
      if (error instanceof CalendarSyncError && error.status === 410 && incremental) {
        logSync(runId, "sync_token_expired", {
          calendar: stableLocalId(calendar.calendar_id),
        });
        return fetchCalendarEvents(
          userId,
          accountId,
          { ...calendar, sync_token: null },
          timeZone,
          runId,
          true
        );
      }
      throw error;
    }
  } while (pageToken);

  logSync(runId, "calendar_received", {
    calendar: stableLocalId(calendar.calendar_id),
    events: events.length,
    incremental,
  });
  return { events, nextSyncToken: nextSyncToken ?? null, incremental };
}

async function storeCalendars(userId: string, accountId: string, calendars: GoogleCalendar[]) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new CalendarSyncError("misconfigured", "A Supabase server key is not configured");
  }
  const { data: existing, error: existingError } = await supabase
    .from("google_calendars")
    .select("calendar_id,sync_token")
    .eq("user_id", userId)
    .eq("google_account_id", accountId);
  if (existingError) {
    throw new CalendarSyncError(
      "error",
      `Unable to read calendar metadata: ${existingError.message}`
    );
  }
  const syncTokens = new Map(
    (existing ?? []).map((row) => [
      String(row.calendar_id),
      row.sync_token ? String(row.sync_token) : null,
    ])
  );
  const rows = calendars.map((calendar) => ({
    user_id: userId,
    google_account_id: accountId,
    calendar_id: calendar.id,
    summary: calendar.summary?.trim() || "Calendar",
    description: calendar.description ?? null,
    time_zone: calendar.timeZone ?? null,
    background_color: calendar.backgroundColor ?? null,
    foreground_color: calendar.foregroundColor ?? null,
    access_role: calendar.accessRole ?? "reader",
    is_primary: Boolean(calendar.primary),
    is_selected: calendar.selected !== false,
    is_hidden: Boolean(calendar.hidden),
    sync_token: syncTokens.get(calendar.id) ?? null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await supabase
      .from("google_calendars")
      .upsert(rows, { onConflict: "google_account_id,calendar_id" });
    if (error) {
      throw new CalendarSyncError(
        "error",
        `Unable to save calendar metadata: ${error.message}`
      );
    }
  }

  const currentIds = new Set(calendars.map((calendar) => calendar.id));
  const removed = (existing ?? [])
    .map((row) => String(row.calendar_id))
    .filter((id) => !currentIds.has(id));
  for (const calendarId of removed) {
    await reconcileCalendarSources({
      userId,
      accountId,
      calendarId,
      activeEventIds: [],
    });
    const { error: planError } = await supabase
      .from("plans")
      .delete()
      .eq("user_id", userId)
      .eq("google_account_id", accountId)
      .eq("google_calendar_id", calendarId);
    if (planError) {
      throw new CalendarSyncError(
        "error",
        `Unable to remove stale calendar events: ${planError.message}`
      );
    }
    const { error: calendarError } = await supabase
      .from("google_calendars")
      .delete()
      .eq("user_id", userId)
      .eq("google_account_id", accountId)
      .eq("calendar_id", calendarId);
    if (calendarError) {
      throw new CalendarSyncError(
        "error",
        `Unable to remove stale calendar metadata: ${calendarError.message}`
      );
    }
  }
  return rows as StoredCalendar[];
}

async function syncOneCalendar(
  userId: string,
  calendar: StoredCalendar,
  eventColors: Record<string, { background?: string; foreground?: string }>,
  timeZone: string,
  runId: string
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new CalendarSyncError("misconfigured", "A Supabase server key is not configured");
  }
  const startedAt = new Date().toISOString();
  const { data: syncRun, error: runError } = await supabase.from("calendar_sync_runs").insert({
    user_id: userId,
    google_account_id: calendar.google_account_id,
    calendar_id: calendar.calendar_id,
    status: "running",
    started_at: startedAt,
  }).select("id").single();
  if (runError) throw new CalendarSyncError("error", `Unable to start calendar sync log: ${runError.message}`);
  await supabase.from("google_calendars").update({
    last_sync_status: "syncing",
    last_sync_error: null,
    updated_at: startedAt,
  }).eq("google_account_id", calendar.google_account_id).eq("calendar_id", calendar.calendar_id);

  try {
    const result = await fetchCalendarEvents(
      userId,
      calendar.google_account_id,
      calendar,
      timeZone,
      runId
    );
    const active = result.events.filter(
      (event): event is CanonicalGoogleEvent & { colorId?: string } =>
        event.status !== "cancelled" && Boolean(event.id && event.start && event.end)
    );
    if (!result.incremental) {
      const { error: legacyError } = await supabase.from("plans")
        .delete()
        .eq("user_id", userId)
        .eq("source", "google")
        .eq("google_account_id", calendar.google_account_id)
        .eq("google_calendar_id", calendar.calendar_id)
        .is("canonical_event_id", null);
      if (legacyError) throw legacyError;
    }
    let duplicatesMerged = 0;
    for (const event of active) {
      const row = eventToPlan(event, calendar);
      if (!row) continue;
      if (event.colorId && eventColors[event.colorId]?.background) {
        row.google_color = eventColors[event.colorId].background ?? row.google_color;
      }
      const canonical = await upsertCanonicalEvent({
        userId,
        accountId: calendar.google_account_id,
        calendarId: calendar.calendar_id,
        event,
        plan: row,
      });
      if (canonical.duplicateMerged) duplicatesMerged += 1;
    }

    const cancelledIds = result.events
      .filter((event) => event.status === "cancelled" && event.id)
      .map((event) => String(event.id));
    let removed = await removeCanonicalSources({
      userId,
      accountId: calendar.google_account_id,
      calendarId: calendar.calendar_id,
      eventIds: cancelledIds,
    });
    if (!result.incremental) {
      removed += await reconcileCalendarSources({
        userId,
        accountId: calendar.google_account_id,
        calendarId: calendar.calendar_id,
        activeEventIds: active.map((event) => event.id),
      });
    }

    const completedAt = new Date().toISOString();
    const { error: metadataError } = await supabase
      .from("google_calendars")
      .update({
        sync_token: result.nextSyncToken,
        last_synced_at: completedAt,
        last_sync_status: "synced",
        last_sync_error: null,
        last_successful_sync_at: completedAt,
        updated_at: completedAt,
      })
      .eq("user_id", userId)
      .eq("google_account_id", calendar.google_account_id)
      .eq("calendar_id", calendar.calendar_id);
    if (metadataError) throw metadataError;
    await supabase.from("calendar_sync_runs").update({
      status: "ok",
      fetched: result.events.length,
      canonical_events: active.length,
      duplicates_merged: duplicatesMerged,
      removed,
      completed_at: completedAt,
    }).eq("id", syncRun.id);
    await supabase.from("sync_errors").update({ resolved_at: completedAt })
      .eq("user_id", userId)
      .eq("service", "google-calendar")
      .eq("calendar_id", calendar.calendar_id)
      .is("resolved_at", null);
    return { imported: active.length, removed, duplicatesMerged };
  } catch (error) {
    const message = errorMessage(error, "Unknown calendar failure");
    const completedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("calendar_sync_runs").update({ status: "error", error_message: message, completed_at: completedAt }).eq("id", syncRun.id),
      supabase.from("google_calendars").update({ last_sync_status: "error", last_sync_error: message, updated_at: completedAt }).eq("google_account_id", calendar.google_account_id).eq("calendar_id", calendar.calendar_id),
      recordSyncError({ userId, accountId: calendar.google_account_id, calendarId: calendar.calendar_id, service: "google-calendar", message }),
    ]);
    throw error;
  }
}

async function readCalendarSummaries(
  userId: string,
  accountId?: string
): Promise<GoogleCalendarSummary[]> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) return [];
  let query = supabase
    .from("google_calendars")
    .select("google_account_id,calendar_id,summary,background_color,access_role,is_primary,last_sync_status,last_sync_error,last_successful_sync_at")
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("summary");
  if (accountId) query = query.eq("google_account_id", accountId);
  const { data } = await query;
  return (data ?? []).map((calendar) => ({
    id: String(calendar.calendar_id),
    accountId: String(calendar.google_account_id),
    name: String(calendar.summary),
    color: calendar.background_color ? String(calendar.background_color) : null,
    accessRole: String(calendar.access_role),
    primary: Boolean(calendar.is_primary),
    state: (calendar.last_sync_status as CalendarSyncState) || "ready",
    lastSuccessfulSyncAt: calendar.last_successful_sync_at ? String(calendar.last_successful_sync_at) : null,
    error: calendar.last_sync_error ? String(calendar.last_sync_error) : null,
  }));
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
      connectedEmail: null,
      calendars: [],
      accounts: [],
    };
  }
  let records;
  try {
    records = await listGoogleAccounts(userId);
  } catch (error) {
    return {
      state: "misconfigured",
      connected: false,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      error: `Calendar sync database migration is missing: ${
        errorMessage(error, "Unknown database error")
      }`,
      timeZone: null,
      connectedEmail: null,
      calendars: [],
      accounts: [],
    };
  }
  if (records.length === 0) {
    return {
      state: "not_connected",
      connected: false,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      error: null,
      timeZone: null,
      connectedEmail: null,
      calendars: [],
      accounts: [],
    };
  }
  const calendars = await readCalendarSummaries(userId);
  const counts = new Map<string, number>();
  const supabase = getServiceSupabaseClient();
  const { data: calendarAccounts } = await supabase!
    .from("google_calendars")
    .select("google_account_id")
    .eq("user_id", userId);
  for (const row of calendarAccounts ?? []) {
    const id = String(row.google_account_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const accounts = records.map((record) => {
    const scopes = String(record.scope ?? "").split(/\s+/);
    const hasRequiredScopes =
      scopes.includes("https://www.googleapis.com/auth/calendar") &&
      scopes.includes("https://www.googleapis.com/auth/gmail.readonly");
    return {
      id: String(record.id),
      email: String(record.connected_email ?? "Google account"),
      name: record.display_name ? String(record.display_name) : null,
      avatarUrl: record.avatar_url ? String(record.avatar_url) : null,
      color: record.account_color ? String(record.account_color) : null,
      state: hasRequiredScopes
        ? ((record.last_sync_status as CalendarSyncState) || "ready")
        : ("auth_expired" as const),
      lastSuccessfulSyncAt: record.last_successful_sync_at
        ? String(record.last_successful_sync_at)
        : null,
      lastEmailSyncAt: record.last_email_sync_at
        ? String(record.last_email_sync_at)
        : null,
      error: hasRequiredScopes
        ? record.last_sync_error
          ? String(record.last_sync_error)
          : null
        : "Reconnect to approve calendar and Gmail access.",
      calendarCount: counts.get(String(record.id)) ?? 0,
    };
  });
  const failures = accounts.filter((account) =>
    ["auth_expired", "unreachable", "misconfigured", "error"].includes(account.state)
  );
  const newestSync = accounts
    .map((account) => account.lastSuccessfulSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    state: failures[0]?.state ?? (newestSync ? "synced" : "ready"),
    connected: true,
    lastSuccessfulSyncAt: newestSync,
    lastAttemptAt: null,
    error: failures[0]?.error ?? null,
    timeZone: records[0]?.calendar_time_zone
      ? String(records[0].calendar_time_zone)
      : null,
    connectedEmail:
      accounts.length === 1 ? accounts[0].email : `${accounts.length} Google accounts`,
    calendars,
    accounts,
  };
}

async function syncGoogleCalendarAccount(
  userId: string,
  accountId: string,
  requestedTimeZone?: string
) {
  const runId = randomUUID();
  const timeZone = validateTimeZone(requestedTimeZone);
  const attemptedAt = new Date().toISOString();
  logSync(runId, "started", { user: userId.slice(0, 8), account: accountId.slice(0, 8), timeZone });

  try {
    const token = await readStoredGoogleToken(userId, accountId);
    if (!token) {
      throw new CalendarSyncError(
        "not_connected",
        "Google Calendar is not connected."
      );
    }
    await setSyncState(userId, accountId, "syncing", {
      last_sync_attempt_at: attemptedAt,
      last_sync_error: null,
      calendar_time_zone: timeZone,
    });

    const [{ calendars, listSyncToken }, eventColors] = await Promise.all([
      fetchCalendars(userId, accountId),
      fetchEventColors(userId, accountId),
    ]);
    if (calendars.length === 0) {
      throw new CalendarSyncError("error", "Google returned no readable calendars.");
    }
    const stored = await storeCalendars(userId, accountId, calendars);
    const primary = calendars.find((calendar) => calendar.primary);
    const connectedEmail = primary?.id.includes("@") ? primary.id : null;
    const totals = { imported: 0, removed: 0, duplicatesMerged: 0 };
    for (const calendar of stored) {
      const result = await syncOneCalendar(
        userId,
        calendar,
        eventColors,
        timeZone,
        runId
      );
      totals.imported += result.imported;
      totals.removed += result.removed;
      totals.duplicatesMerged += result.duplicatesMerged;
    }

    const completedAt = new Date().toISOString();
    await setSyncState(userId, accountId, "synced", {
      last_successful_sync_at: completedAt,
      last_sync_attempt_at: attemptedAt,
      last_sync_error: null,
      calendar_time_zone: timeZone,
      connected_email: token.email ?? connectedEmail,
      calendar_list_sync_token: listSyncToken ?? null,
    });
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new CalendarSyncError("misconfigured", "A Supabase server key is not configured");
    if (totals.duplicatesMerged > 0) {
      const day = completedAt.slice(0, 10);
      const { error: mergeAlertError } = await supabase.from("assistant_alerts").upsert({
        user_id: userId,
        dedupe_key: `calendar-merge-summary:${accountId}:${day}`,
        kind: "calendar_merge",
        severity: "normal",
        title: `${totals.duplicatesMerged} duplicate calendar events merged`,
        summary: "ASS kept one commitment for each real event while retaining every Google source for safe updates and cancellations.",
        status: "pending",
        updated_at: completedAt,
      }, { onConflict: "user_id,dedupe_key" });
      if (mergeAlertError) console.error(JSON.stringify({ service: "google-calendar-sync", runId, stage: "merge_alert_failed", message: mergeAlertError.message }));
    }
    const { error: orphanLegacyError } = await supabase.from("plans")
      .delete()
      .eq("user_id", userId)
      .eq("source", "google")
      .is("google_account_id", null)
      .is("canonical_event_id", null);
    if (orphanLegacyError) throw orphanLegacyError;
    await supabase
      .from("profiles")
      .upsert({
        user_id: userId,
        gmail_connected: true,
        updated_at: completedAt,
      }, { onConflict: "user_id" });
    logSync(runId, "completed", {
      calendars: stored.length,
      imported: totals.imported,
      removed: totals.removed,
      duplicatesMerged: totals.duplicatesMerged,
    });
    return { state: "synced" as const, imported: totals.imported };
  } catch (error) {
    const message = errorMessage(error, "Unknown calendar sync failure");
    const state =
      error instanceof CalendarSyncError
        ? error.state
        : /refresh token|invalid_grant|authorization expired/i.test(message)
          ? "auth_expired"
          : /not configured|migration is missing/i.test(message)
            ? "misconfigured"
            : "error";
    console.error(
      JSON.stringify({
        service: "google-calendar-sync",
        runId,
        stage: "failed",
        state,
        message,
      })
    );
    await setSyncState(userId, accountId, state, {
      last_sync_attempt_at: attemptedAt,
      last_sync_error: message,
      calendar_time_zone: timeZone,
    });
    return { state, imported: 0 };
  }
}

export async function syncGoogleCalendarForUser(
  userId: string,
  requestedTimeZone?: string,
  onlyAccountId?: string
): Promise<CalendarSyncStatus> {
  const accounts = await listGoogleAccounts(userId);
  const targets = onlyAccountId
    ? accounts.filter((account) => String(account.id) === onlyAccountId)
    : accounts;
  if (targets.length === 0) return getCalendarSyncStatus(userId);
  const results = [];
  for (const account of targets) {
    results.push(
      await syncGoogleCalendarAccount(
        userId,
        String(account.id),
        requestedTimeZone ?? String(account.calendar_time_zone ?? "UTC")
      )
    );
  }
  await detectCalendarConflicts(userId);
  const status = await getCalendarSyncStatus(userId);
  return {
    ...status,
    // A newly authorized account should complete its own callback even if a
    // different connected account currently needs reauthorization.
    ...(onlyAccountId && results.every((result) => result.state === "synced")
      ? { state: "synced" as const, error: null }
      : {}),
    eventsImported: results.reduce((total, result) => total + result.imported, 0),
  };
}

function clockValue(label: string) {
  const minutes = labelToMinutes(label);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}:00`;
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + 1);
  return value.toISOString().split("T")[0];
}

function recurrenceRules(plan: SavedPlan) {
  if (plan.recurrence === "daily") return ["RRULE:FREQ=DAILY"];
  if (plan.recurrence === "weekly") return ["RRULE:FREQ=WEEKLY"];
  if (plan.recurrence === "weekdays") {
    return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
  }
  if (plan.recurrence === "weekends") {
    return ["RRULE:FREQ=WEEKLY;BYDAY=SA,SU"];
  }
  if (plan.recurrence === "custom" && plan.customRecurrence?.trim()) {
    const rule = plan.customRecurrence.trim();
    return [rule.startsWith("RRULE:") ? rule : `RRULE:${rule}`];
  }
  return undefined;
}

function googleEventBody(plan: SavedPlan, timeZone: string) {
  return {
    summary: plan.title,
    description: plan.notes || undefined,
    start: plan.allDay
      ? { date: plan.date }
      : {
          dateTime: `${plan.date}T${clockValue(plan.startLabel)}`,
          timeZone,
        },
    end: plan.allDay
      ? { date: nextDate(plan.date) }
      : {
          dateTime: `${plan.date}T${clockValue(plan.endLabel)}`,
          timeZone,
        },
    recurrence: recurrenceRules(plan),
  };
}

async function writableCalendar(
  userId: string,
  requested?: string,
  requestedAccountId?: string
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    throw new CalendarSyncError("misconfigured", "A Supabase server key is not configured");
  }
  let query = supabase
    .from("google_calendars")
    .select("google_account_id,calendar_id,access_role,time_zone")
    .eq("user_id", userId);
  if (requestedAccountId) query = query.eq("google_account_id", requestedAccountId);
  query = requested
    ? query.eq("calendar_id", requested)
    : query.eq("is_primary", true).order("updated_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new CalendarSyncError(
      "error",
      `Unable to resolve destination calendar: ${error.message}`
    );
  }
  if (!data || !["writer", "owner"].includes(String(data.access_role))) {
    throw new CalendarSyncError("error", "The selected Google calendar is read-only.");
  }
  return {
    accountId: String(data.google_account_id),
    id: String(data.calendar_id),
    timeZone: validateTimeZone(
      data.time_zone ? String(data.time_zone) : undefined
    ),
  };
}

export async function createGoogleCalendarEvent(
  userId: string,
  plan: SavedPlan
) {
  const calendar = await writableCalendar(
    userId,
    plan.googleCalendarId,
    plan.googleAccountId
  );
  const created = await googleRequest<GoogleEvent>(
    userId,
    calendar.accountId,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendar.id
    )}/events`,
    {
      method: "POST",
      body: JSON.stringify(googleEventBody(plan, calendar.timeZone)),
    }
  );
  const supabase = getServiceSupabaseClient();
  if (supabase) {
    const { error } = await supabase
      .from("plans")
      .update({
        google_account_id: calendar.accountId,
        google_calendar_id: calendar.id,
        google_event_id: created.body.id ?? null,
        google_recurring_event_id: created.body.recurringEventId ?? null,
        google_etag: created.body.etag ?? null,
        google_updated_at: created.body.updated ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("local_id", plan.id);
    if (error) {
      throw new CalendarSyncError(
        "error",
        `Google event was created, but its local link could not be saved: ${error.message}`
      );
    }
  }
  const now = new Date().toISOString();
  console.info(JSON.stringify({ service: "google-calendar-sync", stage: "event-created", account: calendar.accountId.slice(0, 8), calendar: calendar.id, eventId: created.body.id ?? null }));
  return { state: "synced" as const, connected: true, lastSuccessfulSyncAt: now, lastAttemptAt: now, error: null, timeZone: calendar.timeZone, connectedEmail: null, calendars: [], accounts: [] };
}

export async function updateGoogleCalendarEvent(
  userId: string,
  plan: SavedPlan
) {
  if (!plan.googleEventId || !plan.googleCalendarId) {
    throw new CalendarSyncError(
      "error",
      "This event is not linked to Google Calendar."
    );
  }
  const calendar = await writableCalendar(
    userId,
    plan.googleCalendarId,
    plan.googleAccountId
  );
  await googleRequest<GoogleEvent>(
    userId,
    calendar.accountId,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendar.id
    )}/events/${encodeURIComponent(plan.googleEventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(googleEventBody(plan, calendar.timeZone)),
    }
  );
  const now = new Date().toISOString();
  return { state: "synced" as const, connected: true, lastSuccessfulSyncAt: now, lastAttemptAt: now, error: null, timeZone: calendar.timeZone, connectedEmail: null, calendars: [], accounts: [] };
}

export async function deleteGoogleCalendarEvent(
  userId: string,
  calendarId: string,
  eventId: string,
  accountId?: string
) {
  const calendar = await writableCalendar(userId, calendarId, accountId);
  await googleRequest<Record<string, never>>(
    userId,
    calendar.accountId,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  const now = new Date().toISOString();
  return { state: "synced" as const, connected: true, lastSuccessfulSyncAt: now, lastAttemptAt: now, error: null, timeZone: calendar.timeZone, connectedEmail: null, calendars: [], accounts: [] };
}
