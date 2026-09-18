import { createHash } from "crypto";
import { analyzeFile } from "@/lib/fileIntelligence";
import { indexDocument } from "@/lib/documentGrounding";
import { fulfillDocumentActions } from "@/lib/documentFulfillment";
import { downloadDriveFile } from "@/lib/googleDrive";
import { extractOfficeText } from "@/lib/officeText";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { classifyWritingSpans } from "@/lib/writingStyle";

export async function ingestDriveFile(
  userId: string,
  accountId: string,
  fileId: string,
  selectedByUser = false,
) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: existing } = await supabase
    .from("imported_sources")
    .select("id,processing_status")
    .eq("user_id", userId)
    .eq("source_type", "google_drive")
    .eq("connected_account_id", accountId)
    .eq("external_id", fileId)
    .maybeSingle();
  if (existing)
    return {
      id: String(existing.id),
      itemCount: 0,
      pendingCount: 0,
      alreadyImported: true,
    };
  let sourceId: string | null = null;
  try {
    const downloaded = await downloadDriveFile(userId, accountId, fileId);
    const checksum = createHash("sha256")
      .update(downloaded.buffer)
      .digest("hex");
    const { data: source, error: sourceError } = await supabase
      .from("imported_sources")
      .insert({
        user_id: userId,
        source_type: "google_drive",
        connected_account_id: accountId,
        external_id: fileId,
        processing_status: "analyzing",
        file_metadata: {
          ...downloaded.metadata,
          exportedName: downloaded.name,
          exportedMimeType: downloaded.mimeType,
          checksum,
        },
        user_context: { selectedByUser, accountEmail: downloaded.accountEmail },
      })
      .select("id")
      .single();
    if (sourceError || !source)
      throw sourceError ?? new Error("Could not create the Drive import");
    sourceId = String(source.id);
    await supabase
      .from("google_drive_files")
      .upsert(
        {
          user_id: userId,
          google_account_id: accountId,
          drive_file_id: fileId,
          parent_drive_file_id: downloaded.metadata.parents?.[0] ?? null,
          name: downloaded.metadata.name,
          mime_type: downloaded.metadata.mimeType,
          modified_at: downloaded.metadata.modifiedTime ?? null,
          imported_source_id: sourceId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,google_account_id,drive_file_id" },
      );
    const analysis = await analyzeFile(
      {
        name: downloaded.name,
        mimeType: downloaded.mimeType,
        buffer: downloaded.buffer,
      },
      userId,
    );
    const { data: extraction, error: extractionError } = await supabase
      .from("file_extractions")
      .insert({
        user_id: userId,
        imported_source_id: sourceId,
        model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
        classification: analysis.classification,
        confidence: analysis.confidence,
        summary: analysis.summary,
        structured_data: analysis.structuredData,
        source_text: analysis.sourceText ?? null,
      })
      .select("id")
      .single();
    if (extractionError || !extraction)
      throw extractionError ?? new Error("Could not save Drive analysis");
    let items: Array<{
      id: string;
      required: boolean;
      confidence: number;
      item_type: string;
    }> = [];
    if (analysis.items.length) {
      const { data, error } = await supabase
        .from("extraction_items")
        .insert(
          analysis.items.map((item) => ({
            user_id: userId,
            imported_source_id: sourceId,
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
          })),
        )
        .select("id,required,confidence,item_type");
      if (error) throw error;
      items = data ?? [];
    }
    if (analysis.sourceText)
      await indexDocument(userId, extraction.id, analysis.sourceText);
    const fulfillment = await fulfillDocumentActions(userId, {
      sourceId: sourceId!,
    });
    const impactSaved = await supabase
      .from("file_extractions")
      .update({ structured_data: { ...analysis.structuredData, fulfillment } })
      .eq("user_id", userId)
      .eq("id", extraction.id);
    if (impactSaved.error) throw impactSaved.error;
    const pendingCount = fulfillment.needsReview;
    const writingText = downloaded.mimeType.startsWith("text/")
      ? downloaded.buffer.toString("utf8")
      : downloaded.mimeType.includes("officedocument")
        ? extractOfficeText(downloaded.buffer, downloaded.mimeType)
        : "";
    if (writingText)
      await classifyWritingSpans(userId, sourceId, writingText, "drive");
    await supabase
      .from("imported_sources")
      .update({
        processing_status: pendingCount ? "needs_review" : "extracted",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceId);
    console.info(
      JSON.stringify({
        service: "drive-intelligence",
        stage: "completed",
        sourceId,
        driveFileId: fileId,
        items: items.length,
        fulfillment,
      }),
    );
    return {
      id: sourceId,
      itemCount: items.length,
      pendingCount,
      fulfillment,
      alreadyImported: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Drive import failed.";
    if (sourceId)
      await supabase
        .from("imported_sources")
        .update({
          processing_status: "failed",
          processing_error: message.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceId);
    console.error(
      JSON.stringify({
        service: "drive-intelligence",
        stage: "failed",
        sourceId,
        fileId,
        message,
      }),
    );
    throw error;
  }
}
