import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from "@/lib/googleCalendarSync";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
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
    const plan = readPlan(await request.json());
    const status = await createGoogleCalendarEvent(user.id, plan);
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
    };
    if (!body.googleCalendarId || !body.googleEventId) {
      throw new ApiAuthError("Google calendar and event IDs are required.", 400);
    }
    const status = await deleteGoogleCalendarEvent(
      user.id,
      body.googleCalendarId,
      body.googleEventId
    );
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
