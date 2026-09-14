import { NextRequest, NextResponse } from "next/server";
import { reconcileExtractedItems } from "@/lib/extractionReconciliation";
import { commitExtractionItem } from "@/lib/fileIntelligence";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

async function snapshot(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const [items, events, plans, links, recurring, runs] = await Promise.all([
    supabase.from("extraction_items").select("id,title,item_type,normalized_type,due_at,recurrence_rule,review_status,linked_entity_type,linked_entity_id,conversion_error,ignore_future_imports,deleted_at,payload,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(250),
    supabase.from("canonical_events").select("id,title,start_at,end_at,recurrence_rule,hidden_from_calendar,deleted_at,deletion_reason,source_count").eq("user_id", userId).order("updated_at", { ascending: false }).limit(250),
    supabase.from("plans").select("local_id,canonical_event_id,title,date,start_label,end_label,recurrence,custom_recurrence,source,google_event_id").eq("user_id", userId).order("updated_at", { ascending: false }).limit(250),
    supabase.from("object_source_links").select("source_kind,source_id,destination_kind,destination_id,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(500),
    supabase.from("academic_recurring_events").select("id,extraction_item_id,canonical_event_id,title,academic_kind,days_of_week,start_time,end_time,start_date,end_date,recurrence_rule,location").eq("user_id", userId).order("updated_at", { ascending: false }).limit(100),
    supabase.from("extraction_reconciliation_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(20),
  ]);
  const failed = [items, events, plans, links, recurring, runs].find((result) => result.error)?.error;
  if (failed) throw failed;
  return { extractionItems: items.data ?? [], canonicalEvents: events.data ?? [], plans: plans.data ?? [], sourceLinks: links.data ?? [], recurringEvents: recurring.data ?? [], reconciliationRuns: runs.data ?? [] };
}

export async function GET(request: NextRequest) {
  try { const user = await requireApiUser(request); return NextResponse.json(await snapshot(user.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integrity data is unavailable." }, { status: error instanceof ApiAuthError ? error.status : 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { action?: "reconcile" | "retry_item"; itemId?: string };
    if (body.action === "retry_item" && body.itemId) await commitExtractionItem(user.id, body.itemId, { force: true });
    else if (body.action === "reconcile") await reconcileExtractedItems(user.id, "manual");
    else throw new ApiAuthError("Choose a valid integrity action.", 400);
    return NextResponse.json({ ok: true, snapshot: await snapshot(user.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Integrity action failed." }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
