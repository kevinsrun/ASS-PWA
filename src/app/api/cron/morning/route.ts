import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { getServerSupabaseClient, logCronRun } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronRequest(req);
  if (unauthorized) return unauthorized;

  try {
    const gmail = await scanRecentGmailSuggestions();
    const supabase = getServerSupabaseClient();
    let storedSuggestions = 0;
    let storageWarning = "";

    if (supabase && gmail.connected && gmail.suggestions.length > 0) {
      const { error } = await supabase.from("email_suggestions").upsert(
        gmail.suggestions.map((suggestion) => ({
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
        { onConflict: "external_id" }
      );

      if (error) {
        storageWarning = error.message;
      } else {
        storedSuggestions = gmail.suggestions.length;
      }
    }

    const details = {
      gmailConnected: gmail.connected,
      suggestionsFound: gmail.suggestions.length,
      storedSuggestions,
      storageWarning,
    };

    const log = await logCronRun("morning", "ok", details);

    return NextResponse.json({
      ok: true,
      job: "morning",
      ...details,
      log,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cron error";
    const log = await logCronRun("morning", "error", { message });

    return NextResponse.json(
      {
        ok: false,
        job: "morning",
        error: message,
        log,
      },
      { status: 500 }
    );
  }
}
