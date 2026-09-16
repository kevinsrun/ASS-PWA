import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { nextIntelligenceCheck } from "@/lib/intelligenceSchedule";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const [accounts, drive, runs, drafts, actions, extractions, assistantRuns] = await Promise.all([
      supabase.from("google_tokens").select("id,connected_email,last_sync_status,last_sync_error,last_successful_sync_at,email_sync_status,email_sync_error,last_email_sync_at,gmail_history_id").eq("user_id", user.id).is("disconnected_at", null).order("connected_email"),
      supabase.from("drive_sync_state").select("google_account_id,sync_status,last_successful_sync_at,last_sync_error,last_files_scanned,watched_folder_ids").eq("user_id", user.id),
      supabase.from("intelligence_sync_runs").select("*").contains("user_ids", [user.id]).order("started_at", { ascending: false }).limit(10),
      supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("status", ["ready", "edited"]),
      supabase.from("assistant_action_items").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
      supabase.from("email_extractions").select("id,predicted_label,confidence,status,created_at,email_messages!inner(user_id)").eq("email_messages.user_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("assistant_action_runs").select("id,request_text,parsed_actions,validation_results,conflict_results,execution_results,final_reply,status,error_message,created_at,completed_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    ]);
    const error = [accounts, drive, runs, drafts, actions, extractions, assistantRuns].find((result) => result.error)?.error;
    if (error) throw error;
    return NextResponse.json({
      nextExpectedRun: nextIntelligenceCheck(), scheduler: "GitHub Actions / External", accounts: accounts.data ?? [], drive: drive.data ?? [],
      runs: runs.data ?? [], draftsWaiting: drafts.count ?? 0, decisionsWaiting: actions.count ?? 0,
      classifications: extractions.data ?? [],
      assistantRuns: assistantRuns.data ?? [],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync status is unavailable." }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
