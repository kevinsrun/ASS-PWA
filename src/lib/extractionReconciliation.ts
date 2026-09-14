import { randomUUID } from "crypto";
import { commitExtractionItem } from "@/lib/fileIntelligence";
import { createAssistantAction } from "@/lib/objectCreation";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

type Trigger = "manual" | "cron" | "upload";

async function destinationExists(userId: string, item: Record<string, unknown>) {
  const supabase = getServiceSupabaseClient()!;
  const types = String(item.linked_entity_type ?? "").split(",");
  const ids = String(item.linked_entity_id ?? "").split(",");
  const destination = new Map(types.map((type, index) => [type, ids[index]]));
  const normalized = String(item.normalized_type ?? "");
  if (["reference", "ignore", "course"].includes(normalized)) return Boolean(item.linked_entity_id);
  if (normalized === "task" || normalized === "project") {
    const localId = Number(destination.get("todo"));
    if (!Number.isFinite(localId)) return false;
    const { count } = await supabase.from("todos").select("local_id", { count: "exact", head: true }).eq("user_id", userId).eq("local_id", localId);
    return Boolean(count);
  }
  const canonicalId = destination.get("canonical_event");
  if (!canonicalId) return false;
  const { data } = await supabase.from("canonical_events").select("id,deleted_at,hidden_from_calendar").eq("id", canonicalId).eq("user_id", userId).maybeSingle();
  if (!data || data.deleted_at || data.hidden_from_calendar) return false;
  const { count } = await supabase.from("plans").select("local_id", { count: "exact", head: true }).eq("user_id", userId).eq("canonical_event_id", canonicalId);
  return Boolean(count);
}

export async function reconcileExtractedItems(userId: string, triggerKind: Trigger = "manual") {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const runId = randomUUID();
  await supabase.from("extraction_reconciliation_runs").insert({ id: runId, user_id: userId, trigger_kind: triggerKind });
  const result = { runId, scanned: 0, created: 0, repaired: 0, skipped: 0, errors: [] as Array<{ itemId: string; title: string; message: string }> };
  try {
    const { data, error } = await supabase.from("extraction_items").select("*").eq("user_id", userId).is("deleted_at", null).eq("ignore_future_imports", false).in("normalized_type", ["task", "project", "calendar_event", "deadline", "study_block"]).order("created_at");
    if (error) throw error;
    for (const item of data ?? []) {
      result.scanned += 1;
      const wasCommitted = item.review_status === "committed";
      try {
        if (wasCommitted && await destinationExists(userId, item)) { result.skipped += 1; continue; }
        await commitExtractionItem(userId, String(item.id), { force: true });
        if (wasCommitted) result.repaired += 1; else result.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown conversion failure";
        result.errors.push({ itemId: String(item.id), title: String(item.title), message });
        await supabase.from("extraction_items").update({ conversion_error: message, updated_at: new Date().toISOString() }).eq("id", item.id).eq("user_id", userId);
      }
    }
    const status = result.errors.length ? "partial" : "completed";
    await supabase.from("extraction_reconciliation_runs").update({
      status, scanned: result.scanned, created_count: result.created, repaired_count: result.repaired,
      skipped_count: result.skipped, error_count: result.errors.length, errors: result.errors,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    await createAssistantAction(userId, {
      sourceKind: "reconciliation", sourceId: runId, actionType: "extraction_reconciled",
      title: result.errors.length ? "Some file items need attention" : "File items reconciled",
      summary: `${result.created} created, ${result.repaired} repaired, ${result.skipped} already healthy${result.errors.length ? `, ${result.errors.length} need dates or review` : ""}.`,
      priority: result.errors.length ? "high" : "normal", payload: result,
      status: result.errors.length ? "pending" : "completed",
    });
    console.info(JSON.stringify({ service: "extraction-reconciliation", stage: status, ...result }));
    return { ...result, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reconciliation failure";
    await supabase.from("extraction_reconciliation_runs").update({ status: "failed", errors: [{ message }], error_count: 1, completed_at: new Date().toISOString() }).eq("id", runId);
    throw error;
  }
}
