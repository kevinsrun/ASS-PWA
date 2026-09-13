import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzeFile, commitExtractionItem } from "@/lib/fileIntelligence";
import { downloadDriveFile, listDriveFolder } from "@/lib/googleDrive";
import { listGoogleAccounts } from "@/lib/googleAuth";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { classifyWritingSpans } from "@/lib/writingStyle";
import { extractOfficeText } from "@/lib/officeText";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const accountId = request.nextUrl.searchParams.get("accountId");
    const folderName = request.nextUrl.searchParams.get("folder")?.trim() || "Grow Up";
    const accounts = await listGoogleAccounts(user.id);
    if (!accountId) return NextResponse.json({ accounts: accounts.map((row) => ({ id: row.id, email: row.connected_email, name: row.display_name })) });
    return NextResponse.json({ accounts: accounts.map((row) => ({ id: row.id, email: row.connected_email, name: row.display_name })), ...(await listDriveFolder(user.id, accountId, folderName)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive is unavailable.";
    return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}

export async function POST(request: NextRequest) {
  let sourceId: string | null = null;
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { accountId?: string; fileId?: string };
    if (!body.accountId || !body.fileId) throw new ApiAuthError("Choose a connected account and Drive file.", 400);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const downloaded = await downloadDriveFile(user.id, body.accountId, body.fileId);
    const checksum = createHash("sha256").update(downloaded.buffer).digest("hex");
    const { data: source, error: sourceError } = await supabase.from("imported_sources").insert({
      user_id: user.id, source_type: "google_drive", connected_account_id: body.accountId, external_id: body.fileId,
      processing_status: "analyzing", file_metadata: { ...downloaded.metadata, exportedName: downloaded.name, exportedMimeType: downloaded.mimeType, checksum },
      user_context: { selectedByUser: true, accountEmail: downloaded.accountEmail },
    }).select("id").single();
    if (sourceError?.code === "23505") throw new ApiAuthError("This Drive file has already been imported.", 409);
    if (sourceError || !source) throw sourceError ?? new Error("Could not create the Drive import");
    sourceId = String(source.id);
    await supabase.from("google_drive_files").upsert({ user_id: user.id, google_account_id: body.accountId, drive_file_id: body.fileId, parent_drive_file_id: downloaded.metadata.parents?.[0] ?? null, name: downloaded.metadata.name, mime_type: downloaded.metadata.mimeType, modified_at: downloaded.metadata.modifiedTime ?? null, imported_source_id: sourceId, updated_at: new Date().toISOString() }, { onConflict: "user_id,google_account_id,drive_file_id" });
    const analysis = await analyzeFile({ name: downloaded.name, mimeType: downloaded.mimeType, buffer: downloaded.buffer });
    const { data: extraction, error: extractionError } = await supabase.from("file_extractions").insert({ user_id: user.id, imported_source_id: sourceId, model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash", classification: analysis.classification, confidence: analysis.confidence, summary: analysis.summary, structured_data: analysis.structuredData }).select("id").single();
    if (extractionError || !extraction) throw extractionError ?? new Error("Could not save Drive analysis");
    let items: Array<{ id: string; required: boolean; confidence: number; item_type: string }> = [];
    if (analysis.items.length) {
      const { data, error } = await supabase.from("extraction_items").insert(analysis.items.map((item) => ({ user_id: user.id, imported_source_id: sourceId, extraction_id: extraction.id, item_type: item.type, normalized_type: item.normalizedType, title: item.title, description: item.description, due_at: item.dueAt, duration_minutes: item.durationMinutes, time_zone: item.timeZone, recurrence_rule: item.recurrenceRule, location: item.location, confidence: item.confidence, required: item.required, payload: item.payload }))).select("id,required,confidence,item_type");
      if (error) throw error;
      items = data ?? [];
    }
    const autoCommit = items.filter((item) => item.required && Number(item.confidence) >= 0.94 && ["assignment", "deadline", "task"].includes(item.item_type));
    for (const item of autoCommit) await commitExtractionItem(user.id, item.id);
    const pendingCount = items.length - autoCommit.length;
    const writingText = downloaded.mimeType.startsWith("text/") ? downloaded.buffer.toString("utf8") : downloaded.mimeType.includes("officedocument") ? extractOfficeText(downloaded.buffer, downloaded.mimeType) : "";
    if (writingText) await classifyWritingSpans(user.id, sourceId, writingText, "drive");
    await supabase.from("imported_sources").update({ processing_status: pendingCount ? "needs_review" : "extracted", processing_error: null, updated_at: new Date().toISOString() }).eq("id", sourceId);
    console.info(JSON.stringify({ service: "drive-intelligence", stage: "completed", sourceId, driveFileId: body.fileId, items: items.length, autoCommitted: autoCommit.length }));
    return NextResponse.json({ id: sourceId, itemCount: items.length, pendingCount }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive import failed.";
    if (sourceId) await getServiceSupabaseClient()?.from("imported_sources").update({ processing_status: "failed", processing_error: message.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", sourceId);
    console.error(JSON.stringify({ service: "drive-intelligence", stage: "failed", sourceId, message }));
    return NextResponse.json({ error: message }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
