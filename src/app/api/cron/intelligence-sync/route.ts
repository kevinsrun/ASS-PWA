import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { runIntelligenceSync } from "@/lib/intelligenceOrchestrator";
import { intelligenceScheduleDecision } from "@/lib/intelligenceSchedule";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { processGmailPushQueue, renewGmailWatches } from "@/lib/gmailPush";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const unauthorized = verifyCronRequest(request);
  if (unauthorized) return unauthorized;
  const maintenanceErrors:string[]=[];
  // Push recovery/watch maintenance also run outside the deep-planning window.
  try {
    const retention=await getServiceSupabaseClient()?.rpc("purge_expired_model_training_examples",{p_user_id:null});
    if(retention?.error)throw retention.error;
    const watches=await renewGmailWatches();
    const queued=await processGmailPushQueue(2);
    maintenanceErrors.push(...watches.errors,...queued.flatMap(result=>result.failures));
  } catch(error) {
    console.error(JSON.stringify({service:"gmail-push",stage:"maintenance-failed",message:error instanceof Error ? error.message : "Gmail maintenance failed"}));
    maintenanceErrors.push(error instanceof Error ? error.message : "Gmail maintenance failed");
  }
  const schedule = intelligenceScheduleDecision();
  const developmentForce = process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.get("force") === "1";
  console.info(JSON.stringify({ service: "intelligence-sync", stage: "cron-triggered", ...schedule }));
  if (!schedule.shouldRun && !developmentForce) {
    const supabase = getServiceSupabaseClient();
    const { data: accounts } = await supabase?.from("google_tokens").select("user_id").is("disconnected_at", null) ?? { data: [] };
    const userIds = [...new Set((accounts ?? []).map((account) => String(account.user_id)))];
    await supabase?.from("intelligence_sync_runs").insert({ user_ids: userIds, status: "skipped", trigger_kind: "cron", skip_reason: schedule.reason, completed_at: new Date().toISOString(), details: schedule });
    console.info(JSON.stringify({ service: "intelligence-sync", stage: "cron-skipped", reason: schedule.reason }));
    return NextResponse.json({ ok:!maintenanceErrors.length, skipped: true, ...schedule,maintenanceErrors },{status:maintenanceErrors.length ? 207 : 200});
  }
  try {
    const source = request.headers.get("x-ass-trigger") === "github-actions" ? "github-actions" : "external";
    const result = await runIntelligenceSync("cron", { triggerSource: source });
    return NextResponse.json({ ok: result.status !== "partial" && !maintenanceErrors.length, ...result,maintenanceErrors }, { status: result.status === "partial" || maintenanceErrors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown intelligence sync failure" }, { status: 500 });
  }
}

export const POST = GET;
