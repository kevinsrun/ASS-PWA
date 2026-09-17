import { NextRequest, NextResponse } from "next/server";
import { commitExtractionItem, normalizedExtractionTypes } from "@/lib/fileIntelligence";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { createEventDecision, markExtractionItemIgnored, recordClassificationFeedback } from "@/lib/objectCreation";

export async function POST(request: NextRequest) {
  let attemptedItemId = "unknown";
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { itemId?: string; action?: "approve" | "reject"; normalizedType?: string };
    if (!body.itemId || !body.action || !["approve", "reject"].includes(body.action)) throw new ApiAuthError("Choose an extracted item and an action.", 400);
    if (body.normalizedType && !normalizedExtractionTypes.includes(body.normalizedType as typeof normalizedExtractionTypes[number])) throw new ApiAuthError("Choose a valid conversion type.", 400);
    attemptedItemId = body.itemId;
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const { data: item, error } = await supabase.from("extraction_items").select("id,imported_file_id,imported_source_id,title,description,payload,item_type,normalized_type,confidence,review_status").eq("id", body.itemId).eq("user_id", user.id).single();
    if (error || !item) throw new ApiAuthError("Extracted item not found.", 404);
    let conversionResult: Awaited<ReturnType<typeof commitExtractionItem>> | null = null;
    if (body.action === "approve") {
      const {error: reviewError} = await supabase.from("extraction_items").update({ review_status: "approved",payload:{...item.payload,classification_source:"USER"}, ...(body.normalizedType && body.normalizedType !== item.normalized_type ? {manual_corrected_at:new Date().toISOString()} : {}), updated_at: new Date().toISOString() }).eq("id", body.itemId).eq("user_id", user.id);
      if (reviewError) throw reviewError;
      conversionResult = await commitExtractionItem(user.id, body.itemId, { normalizedType: body.normalizedType });
    } else {
      await markExtractionItemIgnored(user.id, body.itemId);
    }
    await createEventDecision(user.id, { sourceKind: "file", sourceId: body.itemId, decision: body.action, context: { title: item.title, itemType: item.item_type, confidence: item.confidence } });
    await recordClassificationFeedback(user.id, {
      sourceType: "file", sourceId: body.itemId, originalText: String(item.payload?.evidence_text ?? item.description ?? item.title),
      predictedLabel: String(item.item_type), confidence: Number(item.confidence),
      correctedLabel: body.normalizedType ?? null, userAction: body.action,
      context: { importedFileId: item.imported_file_id, importedSourceId: item.imported_source_id },
    });
    if (item.imported_file_id) {
      const { count } = await supabase.from("extraction_items").select("id", { count: "exact", head: true }).eq("imported_file_id", item.imported_file_id).eq("review_status", "pending");
      if (!count) await supabase.from("imported_files").update({ status: "extracted", processing_error: null, updated_at: new Date().toISOString() }).eq("id", item.imported_file_id).eq("user_id", user.id);
    }
    if (item.imported_source_id) {
      const { count } = await supabase.from("extraction_items").select("id", { count: "exact", head: true }).eq("imported_source_id", item.imported_source_id).eq("review_status", "pending");
      if (!count) await supabase.from("imported_sources").update({ processing_status: "extracted", processing_error: null, updated_at: new Date().toISOString() }).eq("id", item.imported_source_id).eq("user_id", user.id);
    }
    return NextResponse.json({ ok: true, result: conversionResult, warning: conversionResult?.calendarResult?.googleError ?? null });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not update this item.";
    console.error(JSON.stringify({ service: "file-intelligence", stage: "review-action-failed", message }));
    try {
      const user = await requireApiUser(request);
      const supabase = getServiceSupabaseClient();
      if (supabase) await supabase.from("assistant_action_items").upsert({ user_id: user.id, source_kind: "extraction_item", source_id: attemptedItemId, action_type: "conversion_failed", title: "Calendar conversion failed", summary: message, priority: "high", status: "failed", error_message: message, updated_at: new Date().toISOString() }, { onConflict: "user_id,source_kind,source_id,action_type" });
    } catch { /* The original auth or conversion error remains authoritative. */ }
    return NextResponse.json({ error: message }, { status });
  }
}
