import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { analyzeFile } from "@/lib/fileIntelligence";
import { indexDocument } from "@/lib/documentGrounding";
import { fulfillDocumentActions } from "@/lib/documentFulfillment";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "md",
  "csv",
  "png",
  "jpg",
  "jpeg",
]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
]);

function failure(error: unknown) {
  const status = error instanceof ApiAuthError ? error.status : 500;
  const message =
    error instanceof Error ? error.message : "File request failed.";
  console.error(
    JSON.stringify({ service: "file-intelligence", stage: "failed", message }),
  );
  return NextResponse.json({ error: message }, { status });
}

function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "file"
  );
}

function validatedMimeType(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension))
    throw new ApiAuthError("That file type is not supported yet.", 415);
  const mime =
    file.type ||
    (extension === "md"
      ? "text/markdown"
      : extension === "csv"
        ? "text/csv"
        : extension === "txt"
          ? "text/plain"
          : "");
  if (!allowedMimeTypes.has(mime))
    throw new ApiAuthError("The file type does not match its extension.", 415);
  return mime;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const [
      { data: files, error: filesError },
      { data: sources, error: sourcesError },
      { data: texts, error: textsError },
      { data: extractions, error: extractionError },
      { data: items, error: itemsError },
      { data: courses, error: coursesError },
    ] = await Promise.all([
      supabase
        .from("imported_files")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("imported_sources")
        .select("*")
        .eq("user_id", user.id)
        .neq("source_type", "file")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("imported_texts")
        .select("id,imported_source_id,title,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("file_extractions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("extraction_items")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("academic_courses")
        .select("id,name,course_code")
        .eq("user_id", user.id),
    ]);
    if (filesError) throw filesError;
    if (sourcesError) throw sourcesError;
    if (textsError) throw textsError;
    if (extractionError) throw extractionError;
    if (itemsError) throw itemsError;
    if (coursesError) throw coursesError;
    // Rows are newest first: keep the latest analysis, not the last/oldest one.
    const extractionByFile = new Map<
      string,
      NonNullable<typeof extractions>[number]
    >();
    const extractionBySource = new Map<
      string,
      NonNullable<typeof extractions>[number]
    >();
    for (const row of extractions ?? []) {
      if (
        row.imported_file_id &&
        !extractionByFile.has(String(row.imported_file_id))
      )
        extractionByFile.set(String(row.imported_file_id), row);
      if (
        row.imported_source_id &&
        !extractionBySource.has(String(row.imported_source_id))
      )
        extractionBySource.set(String(row.imported_source_id), row);
    }
    const courseById = new Map(
      (courses ?? []).map((row) => [String(row.id), row]),
    );
    const itemsByFile = new Map<string, typeof items>();
    const itemsBySource = new Map<string, typeof items>();
    for (const item of items ?? []) {
      const key = String(item.imported_file_id);
      itemsByFile.set(key, [...(itemsByFile.get(key) ?? []), item]);
      if (item.imported_source_id) {
        const sourceKey = String(item.imported_source_id);
        itemsBySource.set(sourceKey, [
          ...(itemsBySource.get(sourceKey) ?? []),
          item,
        ]);
      }
    }
    const textBySource = new Map(
      (texts ?? []).map((row) => [String(row.imported_source_id), row]),
    );
    return NextResponse.json({
      files: (files ?? []).map((file) => ({
        ...file,
        linked_course: file.linked_course_id
          ? (courseById.get(String(file.linked_course_id)) ?? null)
          : null,
        extraction: extractionByFile.get(String(file.id)) ?? null,
        items: itemsByFile.get(String(file.id)) ?? [],
      })),
      texts: (sources ?? []).map((source) => ({
        ...source,
        title:
          textBySource.get(String(source.id))?.title ??
          source.file_metadata?.title ??
          "Imported text",
        last_analyzed_at:
          extractionBySource.get(String(source.id))?.created_at ?? null,
        extraction: extractionBySource.get(String(source.id)) ?? null,
        items: itemsBySource.get(String(source.id)) ?? [],
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  let fileId: string | null = null;
  let importedSourceId: string | null = null;
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiAuthError("Choose a file to import.", 400);
    if (file.size <= 0 || file.size > MAX_BYTES)
      throw new ApiAuthError("Files must be between 1 byte and 25 MB.", 413);
    const mimeType = validatedMimeType(file);
    const sourceValue = String(form.get("source") ?? "local");
    const source = sourceValue === "drag_drop" ? "drag_drop" : "local";
    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const { data: duplicate } = await supabase
      .from("imported_files")
      .select("id")
      .eq("user_id", user.id)
      .eq("checksum", checksum)
      .neq("status", "failed")
      .maybeSingle();
    if (duplicate)
      throw new ApiAuthError("This file is already in your Inbox.", 409);
    const { data: importedSource, error: sourceError } = await supabase
      .from("imported_sources")
      .insert({
        user_id: user.id,
        source_type: "file",
        external_id: checksum,
        processing_status: "analyzing",
        file_metadata: {
          name: file.name.slice(0, 240),
          mimeType,
          byteSize: file.size,
        },
        user_context: {
          courseId: form.get("courseId") || null,
          projectLocalId: form.get("projectLocalId")
            ? Number(form.get("projectLocalId"))
            : null,
        },
      })
      .select("id")
      .single();
    if (sourceError || !importedSource)
      throw sourceError ?? new Error("Could not create the import record");
    importedSourceId = String(importedSource.id);
    const now = new Date();
    const storagePath = `${user.id}/${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("ass-imports")
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;
    const { data: imported, error: insertError } = await supabase
      .from("imported_files")
      .insert({
        user_id: user.id,
        imported_source_id: importedSourceId,
        name: file.name.slice(0, 240),
        source,
        storage_path: storagePath,
        mime_type: mimeType,
        byte_size: file.size,
        checksum,
        status: "analyzing",
        linked_course_id: form.get("courseId") || null,
        linked_project_local_id: form.get("projectLocalId")
          ? Number(form.get("projectLocalId"))
          : null,
      })
      .select("*")
      .single();
    if (insertError || !imported) {
      await supabase.storage.from("ass-imports").remove([storagePath]);
      throw insertError ?? new Error("Could not save the imported file");
    }
    fileId = String(imported.id);
    const analysis = await analyzeFile(
      { name: file.name, mimeType, buffer },
      user.id,
    );
    let linkedCourseId = imported.linked_course_id
      ? String(imported.linked_course_id)
      : null;
    const courseName = String(analysis.structuredData.courseName ?? "").trim();
    if (
      !linkedCourseId &&
      analysis.classification === "syllabus" &&
      courseName
    ) {
      const canvasId =
        9_000_000_000 +
        createHash("sha256")
          .update(`${user.id}:${checksum}:course`)
          .digest()
          .readUInt32BE(0);
      const courseCode = String(
        analysis.structuredData.courseCode ??
          courseName.match(/[A-Z]{2,5}\s*\d{3,5}/i)?.[0] ??
          "Course",
      ).slice(0, 80);
      const { data: course, error: courseError } = await supabase
        .from("academic_courses")
        .upsert(
          {
            user_id: user.id,
            canvas_id: canvasId,
            name: courseName.slice(0, 240),
            course_code: courseCode,
            instructor_name:
              String(analysis.structuredData.professor ?? "").slice(0, 240) ||
              null,
            syllabus_html: analysis.summary,
            raw_data: {
              source: "file",
              importedFileId: fileId,
              ...analysis.structuredData,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,canvas_id" },
        )
        .select("id")
        .single();
      if (courseError || !course)
        throw (
          courseError ??
          new Error("Could not connect this syllabus to Academics")
        );
      linkedCourseId = String(course.id);
    }
    if (linkedCourseId) {
      const linked = await supabase
        .from("imported_files")
        .update({ linked_course_id: linkedCourseId })
        .eq("id", fileId)
        .eq("user_id", user.id);
      if (linked.error) throw linked.error;
    }
    const { data: extraction, error: extractionError } = await supabase
      .from("file_extractions")
      .insert({
        user_id: user.id,
        imported_file_id: fileId,
        imported_source_id: importedSourceId,
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        classification: analysis.classification,
        confidence: analysis.confidence,
        summary: analysis.summary,
        structured_data: analysis.structuredData,
        source_text: analysis.sourceText ?? null,
      })
      .select("id")
      .single();
    if (extractionError || !extraction)
      throw extractionError ?? new Error("Could not save file analysis");
    let insertedItems: Array<{
      id: string;
      required: boolean;
      confidence: number;
      item_type: string;
      review_status: string;
    }> = [];
    if (analysis.items.length) {
      const { data, error: itemsError } = await supabase
        .from("extraction_items")
        .insert(
          analysis.items.map((item) => ({
            user_id: user.id,
            imported_file_id: fileId,
            imported_source_id: importedSourceId,
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
            payload: item.payload,
            optionality: item.optionality,
            attendance_policy: item.attendancePolicy,
            classification_reason: item.classificationReason,
          })),
        )
        .select("id,required,confidence,item_type,review_status");
      if (itemsError) throw itemsError;
      insertedItems = data ?? [];
    }
    if (analysis.sourceText)
      await indexDocument(user.id, extraction.id, analysis.sourceText);
    const fulfillment = await fulfillDocumentActions(user.id, {
      fileId: fileId!,
    });
    const impactSaved = await supabase
      .from("file_extractions")
      .update({ structured_data: { ...analysis.structuredData, fulfillment } })
      .eq("user_id", user.id)
      .eq("id", extraction.id);
    if (impactSaved.error) throw impactSaved.error;
    const pendingCount = fulfillment.needsReview;
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("imported_files")
      .update({
        status: pendingCount > 0 ? "needs_review" : "extracted",
        classification: analysis.classification,
        linked_course_id: linkedCourseId,
        extracted_item_count: insertedItems.length,
        processing_error: null,
        last_analyzed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", fileId)
      .eq("user_id", user.id);
    if (updateError) throw updateError;
    await supabase
      .from("imported_sources")
      .update({
        processing_status: pendingCount > 0 ? "needs_review" : "extracted",
        processing_error: null,
        updated_at: completedAt,
      })
      .eq("id", importedSourceId)
      .eq("user_id", user.id);
    await supabase.from("assistant_alerts").upsert(
      {
        user_id: user.id,
        dedupe_key: `file:${fileId}`,
        kind: "file_import",
        severity: pendingCount ? "normal" : "low",
        title: `${analysis.classification.replaceAll("_", " ")} imported`,
        summary:
          analysis.summary || `Found ${insertedItems.length} extracted items.`,
        recommendation: pendingCount
          ? `Review ${pendingCount} suggested action${pendingCount === 1 ? "" : "s"} in Inbox.`
          : "The file is ready.",
        action_type: "open_inbox",
        action_payload: { importedFileId: fileId },
        status: "pending",
        updated_at: completedAt,
      },
      { onConflict: "user_id,dedupe_key" },
    );
    console.info(
      JSON.stringify({
        service: "file-intelligence",
        fileId,
        stage: "completed",
        classification: analysis.classification,
        items: insertedItems.length,
        fulfillment,
      }),
    );
    return NextResponse.json(
      {
        id: fileId,
        classification: analysis.classification,
        itemCount: insertedItems.length,
        pendingCount,
        fulfillment,
      },
      { status: 201 },
    );
  } catch (error) {
    if (fileId || importedSourceId) {
      const supabase = getServiceSupabaseClient();
      await supabase
        ?.from("imported_files")
        .update({
          status: "failed",
          processing_error:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : "Unknown analysis failure",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);
      if (importedSourceId)
        await supabase
          ?.from("imported_sources")
          .update({
            processing_status: "failed",
            processing_error:
              error instanceof Error
                ? error.message.slice(0, 2000)
                : "Unknown analysis failure",
            updated_at: new Date().toISOString(),
          })
          .eq("id", importedSourceId);
    }
    return failure(error);
  }
}
