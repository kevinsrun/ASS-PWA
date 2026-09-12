import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { syncGoogleCalendarForUser } from "@/lib/googleCalendarSync";
import {
  getServiceSupabaseClient,
  logCronRun,
} from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  const unauthorized = verifyCronRequest(request);
  if (unauthorized) return unauthorized;

  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "A Supabase server key is not configured" },
      { status: 503 }
    );
  }

  const { data, error } = await supabase
    .from("google_tokens")
    .select("id,user_id,calendar_time_zone");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = [];
  for (const connection of data ?? []) {
    results.push(
      await syncGoogleCalendarForUser(
        String(connection.user_id),
        connection.calendar_time_zone
          ? String(connection.calendar_time_zone)
          : "UTC",
        String(connection.id)
      )
    );
  }

  const details = {
    attempted: results.length,
    succeeded: results.filter((result) => result.state === "synced").length,
    failed: results.filter((result) => result.state !== "synced").length,
  };
  const log = await logCronRun(
    "google-calendar",
    details.failed > 0 ? "error" : "ok",
    details
  );
  return NextResponse.json({ ok: details.failed === 0, ...details, log });
}
