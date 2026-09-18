import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { commitExtractionItem } from "@/lib/fileIntelligence";
import { getAutomationSettings } from "@/lib/automationSettings";
export async function fulfillDocumentActions(
  userId: string,
  scope: { fileId?: string; sourceId?: string; kind?: string },
) {
  if (Boolean(scope.fileId) === Boolean(scope.sourceId))
    throw new Error("Choose one document scope");
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("ASS Cloud is not configured");
  const result = {
    calendar: 0,
    deadlines: 0,
    tasks: 0,
    needsReview: 0,
    reference: 0,
    errors: [] as Array<{ itemId: string; message: string }>,
  };
  const settings = await getAutomationSettings(userId);
  const rows = await db
    .from("extraction_items")
    .select("*")
    .eq("user_id", userId)
    .eq(
      scope.fileId ? "imported_file_id" : "imported_source_id",
      scope.fileId ?? scope.sourceId,
    )
    .is("deleted_at", null)
    .eq("ignore_future_imports", false);
  if (rows.error) throw rows.error;
  for (const item of rows.data ?? []) {
    if (scope.kind && item.payload?.subtype !== scope.kind) continue;
    if (["rejected", "committed"].includes(item.review_status)) continue;
    const payload = (item.payload as Record<string, unknown>) ?? {};
    if (["reference", "ignore", "course"].includes(item.normalized_type)) {
      if (payload.bucket === "UNCERTAIN") result.needsReview++;
      else result.reference++;
      continue;
    }
    if (
      settings.mode === "manual" ||
      (item.normalized_type === "deadline" && !settings.create_deadlines) ||
      payload.autoCreate !== true ||
      Number(payload.analysisVersion) < 3 ||
      Number(item.confidence) < 0.94 ||
      item.manual_corrected_at ||
      payload.classification_source === "USER"
    ) {
      result.needsReview++;
      continue;
    }
    // A deleted/hidden canonical destination is a user decision, including partially completed earlier runs.
    const tombstones = await db
      .from("canonical_events")
      .select("deleted_at,hidden_from_calendar")
      .eq("user_id", userId)
      .eq("source_kind", scope.fileId ? "file" : "text")
      .in("source_id", [item.id, `${item.id}:deadline`]);
    if (tombstones.error) throw tombstones.error;
    if (
      tombstones.data?.some((row) => row.deleted_at || row.hidden_from_calendar)
    )
      continue;
    try {
      await commitExtractionItem(userId, item.id);
      if (item.normalized_type === "calendar_event") result.calendar++;
      if (
        item.normalized_type === "calendar_event" &&
        ["exam", "quiz"].includes(String(payload.subtype))
      ) {
        result.deadlines++;
        result.tasks++;
      }
      if (item.normalized_type === "deadline") {
        result.deadlines++;
        result.tasks++;
      }
      if (["task", "project"].includes(item.normalized_type)) result.tasks++;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Fulfillment failed";
      result.errors.push({ itemId: item.id, message });
      result.needsReview++;
      const saved = await db
        .from("extraction_items")
        .update({ conversion_error: message })
        .eq("user_id", userId)
        .eq("id", item.id);
      if (saved.error) throw saved.error;
    }
  }
  return result;
}
