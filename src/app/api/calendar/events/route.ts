import { NextRequest, NextResponse } from "next/server";
import {
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from "@/lib/googleCalendarSync";
import { createCalendarEvent } from "@/lib/calendarEventService";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { SavedPlan } from "@/lib/types";

function errorResponse(error: unknown, startedAt: number) {
  const status = error instanceof ApiAuthError ? error.status : 502;
  const message =
    error instanceof Error ? error.message : "Google Calendar update failed.";
  console.error(
    JSON.stringify({
      service: "google-calendar-events",
      stage: "failed",
      message,
      durationMs: Date.now() - startedAt,
    })
  );
  return NextResponse.json({ error: message }, { status });
}

function readPlan(value: unknown): SavedPlan {
  const plan = (value ?? {}) as Partial<SavedPlan>;
  if (
    typeof plan.title !== "string" ||
    !plan.title.trim() ||
    typeof plan.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) ||
    typeof plan.startLabel !== "string" ||
    typeof plan.endLabel !== "string"
  ) {
    throw new ApiAuthError("A title, date, start time, and end time are required.", 400);
  }
  return {
    id: Number(plan.id ?? Date.now()),
    title: plan.title.trim(),
    date: plan.date,
    startLabel: plan.startLabel,
    endLabel: plan.endLabel,
    recurrence: plan.recurrence ?? "none",
    category: plan.category ?? "other",
    priority: plan.priority ?? "medium",
    notes: plan.notes ?? "",
    customRecurrence: plan.customRecurrence ?? "",
    seriesId: plan.seriesId,
    excludedDates: plan.excludedDates ?? [],
    source: plan.source ?? "ass",
    googleEventId: plan.googleEventId,
    googleAccountId: plan.googleAccountId,
    googleCalendarId: plan.googleCalendarId,
    googleRecurringEventId: plan.googleRecurringEventId,
    googleColor: plan.googleColor,
    googleEtag: plan.googleEtag,
    googleUpdatedAt: plan.googleUpdatedAt,
    allDay: Boolean(plan.allDay),
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireApiUser(request);
    const raw = await request.json() as Partial<SavedPlan> & { sourceKind?: string; sourceId?: string; syncToGoogle?: boolean; location?: string; timeZone?: string; tentative?: boolean; recurrenceRule?: string };
    const plan = readPlan(raw);
    const status = await createCalendarEvent(user.id, {
      title: plan.title, date: plan.date, startLabel: plan.startLabel, endLabel: plan.endLabel,
      recurrence: plan.recurrence, recurrenceRule: raw.recurrenceRule ?? plan.customRecurrence,
      category: plan.category, priority: plan.priority, notes: plan.notes, allDay: plan.allDay,
      location: raw.location, timeZone: raw.timeZone, tentative: raw.tentative,
      sourceKind: (["manual","file","text","gmail","drive","task","habit","project","assistant"].includes(String(raw.sourceKind)) ? raw.sourceKind : "manual") as "manual" | "file" | "text" | "gmail" | "drive" | "task" | "habit" | "project" | "assistant",
      sourceId: String(raw.sourceId ?? plan.id), syncToGoogle: Boolean(raw.syncToGoogle),
      googleAccountId: plan.googleAccountId, googleCalendarId: plan.googleCalendarId,
    });
    console.info(
      JSON.stringify({
        service: "google-calendar-events",
        stage: "created",
        durationMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}

export async function PATCH(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireApiUser(request);
    const plan = readPlan(await request.json());
    const status = await updateGoogleCalendarEvent(user.id, plan);
    console.info(
      JSON.stringify({
        service: "google-calendar-events",
        stage: "updated",
        durationMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}

export async function DELETE(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireApiUser(request);
    const body = (await request.json()) as {
      googleCalendarId?: string;
      googleEventId?: string;
      googleAccountId?: string;
      canonicalEventId?: string;
      localId?: number;
    };
    if (!body.googleCalendarId || !body.googleEventId) {
      throw new ApiAuthError("Google calendar and event IDs are required.", 400);
    }
    const status = await deleteGoogleCalendarEvent(
      user.id,
      body.googleCalendarId,
      body.googleEventId,
      body.googleAccountId
    );
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    if (body.canonicalEventId) {
      const { error: canonicalDeleteError } = await supabase.from("canonical_events").delete().eq("id", body.canonicalEventId).eq("user_id", user.id);
      if (canonicalDeleteError) throw canonicalDeleteError;
    } else {
      const query = supabase.from("plans").delete().eq("user_id", user.id).eq("google_calendar_id", body.googleCalendarId).eq("google_event_id", body.googleEventId);
      const { error: planDeleteError } = body.googleAccountId ? await query.eq("google_account_id", body.googleAccountId) : await query;
      if (planDeleteError) throw planDeleteError;
    }
    console.info(
      JSON.stringify({
        service: "google-calendar-events",
        stage: "deleted",
        durationMs: Date.now() - startedAt,
      })
    );
    return NextResponse.json(status);
  } catch (error) {
    return errorResponse(error, startedAt);
  }
}
