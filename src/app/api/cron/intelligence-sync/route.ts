import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { runIntelligenceSync } from "@/lib/intelligenceOrchestrator";
import { intelligenceScheduleDecision } from "@/lib/intelligenceSchedule";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const unauthorized = verifyCronRequest(request);
  if (unauthorized) return unauthorized;
  const schedule = intelligenceScheduleDecision();
  const developmentForce = process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.get("force") === "1";
  console.info(JSON.stringify({ service: "intelligence-sync", stage: "cron-triggered", ...schedule }));
  if (!schedule.shouldRun && !developmentForce) {
    const supabase = getServiceSupabaseClient();
    const { data: accounts } = await supabase?.from("google_tokens").select("user_id") ?? { data: [] };
    const userIds = [...new Set((accounts ?? []).map((account) => String(account.user_id)))];
    await supabase?.from("intelligence_sync_runs").insert({ user_ids: userIds, status: "skipped", trigger_kind: "cron", skip_reason: schedule.reason, completed_at: new Date().toISOString(), details: schedule });
    console.info(JSON.stringify({ service: "intelligence-sync", stage: "cron-skipped", reason: schedule.reason }));
    return NextResponse.json({ ok: true, skipped: true, ...schedule });
  }
  try {
    const result = await runIntelligenceSync("cron");
    return NextResponse.json({ ok: result.status === "completed", ...result }, { status: result.status === "partial" ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown intelligence sync failure" }, { status: 500 });
  }
}
