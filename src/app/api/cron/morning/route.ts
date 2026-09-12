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
      .select("user_id");
    if (connectionError) throw connectionError;

    let suggestionsFound = 0;
    let storedSuggestions = 0;
    const failures: string[] = [];

    for (const connection of connections ?? []) {
      const userId = String(connection.user_id);
      try {
        const gmail = await scanRecentGmailSuggestions(userId);
        suggestionsFound += gmail.suggestions.length;
        if (gmail.suggestions.length === 0) continue;
        const { error } = await supabase.from("email_suggestions").upsert(
          gmail.suggestions.map((suggestion) => ({
            user_id: userId,
            external_id: suggestion.id,
            title: suggestion.title,
            date: suggestion.date,
            time: suggestion.time,
            duration: suggestion.duration,
            category: suggestion.category,
            source: suggestion.source,
            status: "pending",
            created_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,external_id" }
        );
        if (error) throw error;
        storedSuggestions += gmail.suggestions.length;
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
      storedSuggestions,
      failures,
    };
    const log = await logCronRun(
      "morning",
      failures.length > 0 ? "error" : "ok",
      details
    );
    return NextResponse.json({ ok: failures.length === 0, job: "morning", ...details, log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    const log = await logCronRun("morning", "error", { message });
    return NextResponse.json(
      { ok: false, job: "morning", error: message, log },
      { status: 500 }
    );
  }
}
