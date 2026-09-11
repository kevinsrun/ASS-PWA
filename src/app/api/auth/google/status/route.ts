import { NextRequest, NextResponse } from "next/server";
import { getCalendarSyncStatus } from "@/lib/googleCalendarSync";
import { googleConfiguration } from "@/lib/googleAuth";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const config = googleConfiguration();
    return NextResponse.json({
      ...(await getCalendarSyncStatus(user.id)),
      clientConfigured: config.ready,
      missingConfiguration: config.missing,
      redirectUri: config.redirectUri,
    });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Unable to read Google status.";
    return NextResponse.json({ error: message }, { status });
  }
}
