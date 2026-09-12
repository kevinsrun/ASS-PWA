import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
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

  try {
    const { data: connections, error: connectionError } = await supabase
      .from("google_tokens")
      .select("id,user_id");
    if (connectionError) throw connectionError;

    let suggestionsFound = 0;
    const failures: string[] = [];

    for (const connection of connections ?? []) {
      const userId = String(connection.user_id);
      try {
        const gmail = await scanRecentGmailSuggestions(
          userId,
          String(connection.id)
        );
        suggestionsFound += gmail.suggestions.length;
        failures.push(...gmail.failures);
      } catch (error) {
        failures.push(
          `${userId.slice(0, 8)}: ${
            error instanceof Error ? error.message : "Unknown Gmail failure"
          }`
        );
      }
    }

    const details = {
      accounts: connections?.length ?? 0,
      suggestionsFound,
      failures,
    };
    const log = await logCronRun(
      "email-intelligence",
      failures.length > 0 ? "error" : "ok",
      details
    );
    return NextResponse.json({ ok: failures.length === 0, job: "email-intelligence", ...details, log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    const log = await logCronRun("morning", "error", { message });
    return NextResponse.json(
      { ok: false, job: "morning", error: message, log },
      { status: 500 }
    );
  }
}
