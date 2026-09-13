import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { syncGoogleCalendarForUser } from "@/lib/googleCalendarSync";
import { refreshFinanceAlerts } from "@/lib/finance";
import { plaidConfiguration, syncPlaidForUser } from "@/lib/plaid";
import { getServiceSupabaseClient, logCronRun } from "@/lib/supabaseServer";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const unauthorized = verifyCronRequest(request);
  if (unauthorized) return unauthorized;
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "A Supabase server key is not configured" }, { status: 503 });
  }

  try {
    const { data: connections, error } = await supabase
      .from("google_tokens")
      .select("id,user_id,calendar_time_zone");
    if (error) throw error;

    let calendarEvents = 0;
    let emailInsights = 0;
    let financeItems = 0;
    const failures: string[] = [];
    for (const connection of connections ?? []) {
      const userId = String(connection.user_id);
      const accountId = String(connection.id);
      const calendar = await syncGoogleCalendarForUser(
        userId,
        connection.calendar_time_zone ? String(connection.calendar_time_zone) : "UTC",
        accountId
      );
      calendarEvents += calendar.eventsImported ?? 0;
      if (calendar.state !== "synced") {
        failures.push(`${accountId.slice(0, 8)} calendar: ${calendar.error ?? calendar.state}`);
      }
      const email = await scanRecentGmailSuggestions(userId, accountId);
      emailInsights += email.suggestions.length;
      failures.push(...email.failures);
    }
    if (plaidConfiguration().ready) {
      const { data: financeUsers, error: financeUsersError } = await supabase
        .from("plaid_items")
        .select("user_id");
      if (financeUsersError) throw financeUsersError;
      for (const userId of new Set((financeUsers ?? []).map((item) => String(item.user_id)))) {
        try {
          const finance = await syncPlaidForUser(userId);
          financeItems += finance.length;
          await refreshFinanceAlerts(userId);
        } catch (error) {
          failures.push(`${userId.slice(0, 8)} finance: ${error instanceof Error ? error.message : "Unknown failure"}`);
        }
      }
    }

    const details = {
      accounts: connections?.length ?? 0,
      calendarEvents,
      emailInsights,
      financeItems,
      failures,
    };
    const log = await logCronRun("google-life-sync", failures.length ? "error" : "ok", details);
    return NextResponse.json({ ok: failures.length === 0, ...details, log }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync failure";
    const log = await logCronRun("google-life-sync", "error", { message });
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}
