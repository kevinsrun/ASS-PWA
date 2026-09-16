import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzeFile, commitExtractionItem } from "@/lib/fileIntelligence";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { classifyWritingSpans } from "@/lib/writingStyle";

export const runtime = "nodejs";
export const maxDuration = 300;

const sourceTypes = new Set(["pasted_text", "manual_text", "imessage"]);

export async function POST(request: NextRequest) {
  let sourceId: string | null = null;
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { title?: string; content?: string; sourceType?: string };
    const title = String(body.title ?? "Pasted text").trim().slice(0, 240) || "Pasted text";
    const content = String(body.content ?? "").trim();
    if (!content || content.length > 250_000) throw new ApiAuthError("Paste between 1 and 250,000 characters.", 400);
    const sourceType = sourceTypes.has(String(body.sourceType)) ? String(body.sourceType) : "pasted_text";
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const checksum = createHash("sha256").update(`${sourceType}:${content}`).digest("hex");
    const { data: source, error: sourceError } = await supabase.from("imported_sources").insert({
      user_id: user.id, source_type: sourceType, external_id: checksum, content, processing_status: "analyzing",
      file_metadata: { title, characterCount: content.length }, user_context: sourceType === "imessage" ? { direction: "sent_only", confirmedByUser: true } : {},
    }).select("id").single();
    if (sourceError?.code === "23505") throw new ApiAuthError("This text is already in your Inbox.", 409);
    if (sourceError || !source) throw sourceError ?? new Error("Could not create the text import");
    sourceId = String(source.id);
    const { error: textError } = await supabase.from("imported_texts").insert({ user_id: user.id, imported_source_id: sourceId, title, content });
    if (textError) throw textError;
    const analysis = await analyzeFile({ name: `${title}.txt`, mimeType: "text/plain", buffer: Buffer.from(content) }, user.id);
    const { data: extraction, error: extractionError } = await supabase.from("file_extractions").insert({
      user_id: user.id, imported_source_id: sourceId, model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      classification: analysis.classification, confidence: analysis.confidence, summary: analysis.summary, structured_data: analysis.structuredData,
    }).select("id").single();
    if (extractionError || !extraction) throw extractionError ?? new Error("Could not save text analysis");
    let items: Array<{ id: string; required: boolean; confidence: number; item_type: string }> = [];
    if (analysis.items.length) {
      const { data, error } = await supabase.from("extraction_items").insert(analysis.items.map((item) => ({
        user_id: user.id, imported_source_id: sourceId, extraction_id: extraction.id, item_type: item.type, normalized_type: item.normalizedType,
        title: item.title, description: item.description, due_at: item.dueAt, duration_minutes: item.durationMinutes,
        time_zone: item.timeZone, recurrence_rule: item.recurrenceRule, location: item.location,
        confidence: item.confidence, required: item.required, payload: item.payload,
        optionality: item.optionality, attendance_policy: item.attendancePolicy, classification_reason: item.classificationReason,
      }))).select("id,required,confidence,item_type");
      if (error) throw error;
      items = data ?? [];
    }
    const autoCommit = items.filter((item) => item.required && Number(item.confidence) >= 0.94 && ["assignment", "deadline", "task"].includes(item.item_type));
    for (const item of autoCommit) await commitExtractionItem(user.id, item.id);
    const pendingCount = items.length - autoCommit.length;
    if (sourceType === "imessage") await classifyWritingSpans(user.id, sourceId, content, "imessage_manual");
    const completedAt = new Date().toISOString();
    await supabase.from("imported_sources").update({ processing_status: pendingCount ? "needs_review" : "extracted", processing_error: null, updated_at: completedAt }).eq("id", sourceId).eq("user_id", user.id);
    console.info(JSON.stringify({ service: "text-intelligence", stage: "completed", sourceId, sourceType, items: items.length, autoCommitted: autoCommit.length }));
    return NextResponse.json({ id: sourceId, classification: analysis.classification, itemCount: items.length, pendingCount }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text import failed.";
    if (sourceId) await getServiceSupabaseClient()?.from("imported_sources").update({ processing_status: "failed", processing_error: message.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", sourceId);
    console.error(JSON.stringify({ service: "text-intelligence", stage: "failed", sourceId, message }));
    return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
