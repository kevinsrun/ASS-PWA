import { NextRequest, NextResponse } from "next/server";
import {
  getCalendarSyncStatus,
  syncGoogleCalendarForUser,
} from "@/lib/googleCalendarSync";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

function errorResponse(error: unknown) {
  const status = error instanceof ApiAuthError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Calendar sync failed.";
  console.error("Calendar sync route failed:", message);
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json(await getCalendarSyncStatus(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      timeZone?: string;
    };
    const result = await syncGoogleCalendarForUser(user.id, body.timeZone);
    return NextResponse.json(result, {
      status:
        result.state === "synced"
          ? 200
          : result.state === "not_connected"
            ? 409
            : 502,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
