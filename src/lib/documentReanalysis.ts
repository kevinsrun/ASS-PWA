import { analyzeFile } from "@/lib/fileIntelligence";
import { GEMINI_MODELS } from "@/lib/geminiModels";
import { planReanalysisMerge } from "@/lib/reanalysisMerge";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { ApiAuthError } from "@/lib/serverAuth";
import { downloadDriveFile } from "@/lib/googleDrive";
import { indexDocument } from "@/lib/documentGrounding";
import { fulfillDocumentActions } from "@/lib/documentFulfillment";
export async function reanalyzeSource(
  userId: string,
  body: { fileId?: string; sourceId?: string },
) {
  let lease: {
    table: string;
    id: string;
    userId: string;
    field: string;
    previous: string;
  } | null = null;
  let leaseClaimed = false;
  try {
    const user = { id: userId };
    if (Boolean(body.fileId) === Boolean(body.sourceId))
      throw new ApiAuthError("Choose one imported file or text source", 400);
    const db = getServiceSupabaseClient();
    if (!db) throw new Error("A Supabase server key is not configured");
    let fileId: string | null = null,
      sourceId: string | null = body.sourceId ?? null;
    type Original = { name: string; mimeType: string; buffer: Buffer };
    let fetchOriginal: (() => Promise<Original>) | undefined;
    let version: string;
    if (body.fileId) {
      const { data: file, error } = await db
        .from("imported_files")
        .select("*")
        .eq("id", body.fileId)
        .eq("user_id", user.id)
        .single();
      if (error || !file)
        throw new ApiAuthError("Imported file not found", 404);
      if (
        file.status === "analyzing" &&
        !file.processing_error &&
        Date.now() - Date.parse(file.updated_at) < 15 * 60_000
      )
        throw new ApiAuthError("This file is already being analyzed", 409);
      fileId = file.id;
      sourceId = file.imported_source_id;
      version = file.updated_at;
      lease = {
        table: "imported_files",
        id: file.id,
        userId: user.id,
        field: "status",
        previous: file.status,
      };
      fetchOriginal = async () => {
        const { data: download, error: downloadError } = await db.storage
          .from(file.storage_bucket ?? "ass-imports")
          .download(file.storage_path);
        if (downloadError || !download)
          throw downloadError ?? new Error("Source file is unavailable");
        return {
          name: file.name,
          mimeType: file.mime_type,
          buffer: Buffer.from(await download.arrayBuffer()),
        };
      };
    } else {
      const { data: source, error } = await db
        .from("imported_sources")
        .select("*")
        .eq("id", sourceId)
        .eq("user_id", user.id)
        .single();
      if (error || !source)
        throw new ApiAuthError("Imported source not found", 404);
      if (
        source.processing_status === "analyzing" &&
        !source.processing_error &&
        Date.now() - Date.parse(source.updated_at) < 15 * 60_000
      )
        throw new ApiAuthError("This source is already being analyzed", 409);
      version = source.updated_at;
      lease = {
        table: "imported_sources",
        id: source.id,
        userId: user.id,
        field: "processing_status",
        previous: source.processing_status,
      };
      if (source.source_type === "google_drive") {
        if (!source.connected_account_id)
          throw new ApiAuthError(
            "Reconnect this Google Drive account before re-analysis",
            409,
          );
        fetchOriginal = async () => {
          const downloaded = await downloadDriveFile(
            user.id,
            source.connected_account_id,
            source.external_id,
          );
          return {
            name: downloaded.name,
            mimeType: downloaded.mimeType,
            buffer: downloaded.buffer,
          };
        };
      } else {
        if (!source.content)
          throw new ApiAuthError(
            "Source text is unavailable for re-analysis",
            409,
          );
        fetchOriginal = async () => ({
          name: String(source.file_metadata?.title ?? "Imported text") + ".txt",
          mimeType: "text/plain",
          buffer: Buffer.from(source.content),
        });
      }
    }
    const { data: claimed, error: claimError } = await db
      .from(lease.table)
      .update({
        [lease.field]: "analyzing",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lease.id)
      .eq("user_id", user.id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) {
      lease = null;
      if (claimError) throw claimError;
      throw new ApiAuthError(
        "This source changed or another analysis started. Refresh and try again.",
        409,
      );
    }
    leaseClaimed = true;
    if (!fetchOriginal) throw new Error("Original content resolver is missing");
    const input = await fetchOriginal();
    let query = db.from("extraction_items").select("*").eq("user_id", user.id);
    query = fileId
      ? query.eq("imported_file_id", fileId)
      : query.eq("imported_source_id", sourceId);
    const { data: existing, error: existingError } = await query;
    if (existingError) throw existingError;
    const analysis = await analyzeFile(input, user.id,{bypassCache:true});
    const { data: extraction, error } = await db
      .from("file_extractions")
      .insert({
        user_id: user.id,
        imported_file_id: fileId,
        imported_source_id: sourceId,
        model: GEMINI_MODELS.reasoning,
        classification: analysis.classification,
        confidence: analysis.confidence,
        summary: analysis.summary,
        structured_data: analysis.structuredData,
        source_text: analysis.sourceText ?? null,
      })
      .select("id")
      .single();
    if (error || !extraction)
      throw error ?? new Error("Re-analysis could not be persisted");
    const merge = planReanalysisMerge(existing ?? [], analysis.items);
    const row = (item: (typeof analysis.items)[number]) => ({
      extraction_id: extraction.id,
      item_type: item.type,
      normalized_type: item.normalizedType,
      title: item.title,
      description: item.description,
      due_at: item.dueAt,
      duration_minutes: item.durationMinutes,
      time_zone: item.timeZone,
      recurrence_rule: item.recurrenceRule,
      location: item.location,
      confidence: item.confidence,
      required: item.required,
      optionality: item.optionality,
      attendance_policy: item.attendancePolicy,
      classification_reason: item.classificationReason,
      payload: item.payload,
      updated_at: new Date().toISOString(),
    });
    for (const update of merge.updates) {
      const { error } = await db
        .from("extraction_items")
        .update(row(update.item))
        .eq("user_id", user.id)
        .eq("id", update.id)
        .eq("review_status", "pending")
        .is("manual_corrected_at", null)
        .is("deleted_at", null)
        .eq("ignore_future_imports", false);
      if (error) throw error;
    }
    if (merge.additions.length) {
      const { error } = await db
        .from("extraction_items")
        .insert(
          merge.additions.map((item) => ({
            ...row(item),
            user_id: user.id,
            imported_file_id: fileId,
            imported_source_id: sourceId,
          })),
        );
      if (error) throw error;
    }
    if (merge.unmatched.length) {
      const { error } = await db
        .from("extraction_items")
        .update({
          item_type: "unknown",
          normalized_type: "reference",
          confidence: 0.49,
          classification_reason:
            "Not reproduced by the improved factual analysis. No action was created.",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .in("id", merge.unmatched)
        .eq("review_status", "pending")
        .is("manual_corrected_at", null)
        .is("deleted_at", null)
        .eq("ignore_future_imports", false);
      if (error) throw error;
    }
    if (analysis.sourceText)
      await indexDocument(user.id, extraction.id, analysis.sourceText);
    const fulfillment = await fulfillDocumentActions(
      user.id,
      fileId ? { fileId } : { sourceId: sourceId! },
    );
    const impactSaved = await db
      .from("file_extractions")
      .update({ structured_data: { ...analysis.structuredData, fulfillment } })
      .eq("user_id", user.id)
      .eq("id", extraction.id);
    if (impactSaved.error) throw impactSaved.error;
    const status = fulfillment.needsReview ? "needs_review" : "extracted";
    if (fileId) {
      const { error } = await db
        .from("imported_files")
        .update({
          classification: analysis.classification,
          status,
          last_analyzed_at: new Date().toISOString(),
          processing_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId)
        .eq("user_id", user.id);
      if (error) throw error;
    }
    if (sourceId) {
      const { error } = await db
        .from("imported_sources")
        .update({
          processing_status: status,
          processing_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceId)
        .eq("user_id", user.id);
      if (error) throw error;
    }
    return {
      updated: merge.updates.length,
      added: merge.additions.length,
      preserved: merge.preserved,
      fulfillment,
      requiresReview: fulfillment.needsReview > 0,
      changes: merge.updates.map((update) => {
        const previous = (existing ?? []).find((item) => item.id === update.id);
        return {
          id: update.id,
          title: update.item.title,
          from: previous?.normalized_type,
          to: update.item.normalizedType,
          timeChanged: previous?.due_at !== update.item.dueAt,
        };
      }),
      removedFalseEvents: (existing ?? []).filter(
        (item) =>
          merge.unmatched.includes(item.id) &&
          item.normalized_type === "calendar_event",
      ).length,
    };
  } catch (error) {
    if (lease && leaseClaimed) {
      const db = getServiceSupabaseClient();
      await db
        ?.from(lease.table)
        .update({
          [lease.field]:
            lease.previous === "analyzing" ? "failed" : lease.previous,
          processing_error:
            error instanceof Error ? error.message : "Re-analysis failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", lease.id)
        .eq("user_id", lease.userId)
        .eq(lease.field, "analyzing");
    }
    console.error(
      JSON.stringify({
        service: "document-reanalysis",
        stage: "failed",
        message: error instanceof Error ? error.message : "Re-analysis failed",
      }),
    );
    throw error;
  }
}
