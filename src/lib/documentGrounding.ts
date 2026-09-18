import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { segmentDocument } from "@/lib/classificationGuardrails";
import { extractDocumentText } from "@/lib/documentText";
import { downloadDriveFile } from "@/lib/googleDrive";
import {
  embedDocumentText,
  documentEmbeddingModel,
} from "@/lib/documentEmbeddings";
export function documentChunks(text: string) {
  return segmentDocument(text)
    .flatMap((section) => {
      const chunks: Array<{
        section_kind: string;
        location: string;
        content: string;
      }> = [];
      for (let offset = 0; offset < section.text.length; offset += 1600)
        chunks.push({
          section_kind: section.kind,
          location: `${section.location}; characters ${offset + 1}–${Math.min(offset + 2000, section.text.length)}`,
          content: section.text.slice(offset, offset + 2000),
        });
      return chunks;
    })
    .map((chunk, ordinal) => ({ ...chunk, ordinal }));
}
export async function indexDocument(
  userId: string,
  extractionId: string,
  text: string,
) {
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("ASS Cloud is not configured");
  const owner = await db
    .from("file_extractions")
    .select("id")
    .eq("user_id", userId)
    .eq("id", extractionId)
    .single();
  if (owner.error) throw owner.error;
  const chunks = documentChunks(text);
  if (chunks.length) {
    const result = await db.from("document_chunks").upsert(
      chunks.map((chunk) => ({
        ...chunk,
        user_id: userId,
        extraction_id: extractionId,
      })),
      { onConflict: "extraction_id,ordinal" },
    );
    if (result.error) throw result.error;
  }
  const started = Date.now();
  try {
    for (let offset = 0; offset < chunks.length; offset += 4) {
      if (Date.now() - started > 45000)
        throw new Error(
          "Semantic indexing time budget reached; remaining chunks use indexed text retrieval.",
        );
      const batch = await Promise.all(
        chunks
          .slice(offset, offset + 4)
          .map(async (chunk) => ({
            ...chunk,
            embedding: JSON.stringify(
              await embedDocumentText(
                chunk.content,
                "document",
                chunk.section_kind,
              ),
            ),
            embedding_model: documentEmbeddingModel,
            user_id: userId,
            extraction_id: extractionId,
          })),
      );
      const saved = await db
        .from("document_chunks")
        .upsert(batch, { onConflict: "extraction_id,ordinal" });
      if (saved.error) throw saved.error;
    }
    const saved = await db
      .from("file_extractions")
      .update({ embedded_at: new Date().toISOString(), embedding_error: null })
      .eq("user_id", userId)
      .eq("id", extractionId);
    if (saved.error) throw saved.error;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Semantic indexing failed";
    const saved = await db
      .from("file_extractions")
      .update({ embedding_error: message })
      .eq("user_id", userId)
      .eq("id", extractionId);
    if (saved.error) throw saved.error;
    console.warn(
      JSON.stringify({
        service: "document-embeddings",
        stage: "text-fallback",
        message,
      }),
    );
  }
}
export function retrievalTerms(question: string) {
  const extras = [];
  if (/miss|mandatory|attend|absence|skip|participat/i.test(question))
    extras.push(
      "attendance",
      "absence",
      "participation",
      "mandatory",
      "policy",
    );
  if (/grade|percent|weight|homework/i.test(question))
    extras.push("grading", "grade", "homework", "assessment");
  if (/late|submit|extension/i.test(question))
    extras.push("late", "submission", "extension", "policy");
  if (/book|text|material|reading/i.test(question))
    extras.push("textbook", "required", "materials", "reading");
  if (/exam|quiz|test|first/i.test(question))
    extras.push("exam", "quiz", "midterm", "final");
  if (/office|professor|instructor|contact/i.test(question))
    extras.push("office", "instructor", "contact");
  return [
    ...new Set([
      ...(question.toLowerCase().match(/[a-z]{3,}/g) ?? []),
      ...extras,
    ]),
  ]
    .filter(
      (word) =>
        ![
          "the",
          "are",
          "what",
          "when",
          "can",
          "how",
          "does",
          "this",
          "about",
          "syllabus",
          "uploaded",
        ].includes(word),
    )
    .slice(0, 24)
    .join(" or ");
}
export async function retrieveDocument(
  userId: string,
  input: { fileId?: string; sourceId?: string; question: string },
) {
  if (Boolean(input.fileId) === Boolean(input.sourceId))
    throw new Error("Choose one fileId or sourceId from documents_search");
  const db = getServiceSupabaseClient();
  if (!db) throw new Error("ASS Cloud is not configured");
  let query = db
    .from("file_extractions")
    .select(
      "id,classification,summary,structured_data,source_text,created_at,embedding_error",
    )
    .eq("user_id", userId);
  query = input.fileId
    ? query.eq("imported_file_id", input.fileId)
    : query.eq("imported_source_id", input.sourceId);
  const latest = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  if (!latest.data)
    throw new Error(
      "No saved document analysis. Analyze this source in Inbox first.",
    );
  const extraction = latest.data;
  let structured = extraction.structured_data as Record<string, unknown>;
  let originalText: string | null = extraction.source_text;
  if (!originalText) {
    if (input.fileId) {
      const file = await db
        .from("imported_files")
        .select("name,mime_type,storage_bucket,storage_path")
        .eq("user_id", userId)
        .eq("id", input.fileId)
        .single();
      if (file.error || !file.data)
        throw file.error ?? new Error("Original file not found");
      const stored = await db.storage
        .from(file.data.storage_bucket ?? "ass-imports")
        .download(file.data.storage_path);
      if (stored.error || !stored.data)
        throw stored.error ?? new Error("Original file unavailable");
      originalText = await extractDocumentText({
        name: file.data.name,
        mimeType: file.data.mime_type,
        buffer: Buffer.from(await stored.data.arrayBuffer()),
      });
    } else {
      const source = await db
        .from("imported_sources")
        .select("content,source_type,connected_account_id,external_id")
        .eq("user_id", userId)
        .eq("id", input.sourceId)
        .single();
      if (source.error) throw source.error;
      originalText = source.data?.content ?? null;
      if (!originalText && source.data?.source_type === "google_drive") {
        const file = await downloadDriveFile(
          userId,
          source.data.connected_account_id,
          source.data.external_id,
        );
        originalText = await extractDocumentText(file);
      }
    }
    if (originalText) {
      const saved = await db
        .from("file_extractions")
        .update({ source_text: originalText })
        .eq("user_id", userId)
        .eq("id", extraction.id);
      if (saved.error) throw saved.error;
      await indexDocument(userId, extraction.id, originalText);
    }
  }
  const terms = retrievalTerms(input.question);
  let chunks = db
    .from("document_chunks")
    .select("id,ordinal,section_kind,location,content")
    .eq("user_id", userId)
    .eq("extraction_id", extraction.id);
  if (terms)
    chunks = chunks.textSearch("search_vector", terms, {
      type: "websearch",
      config: "english",
    });
  const found = await chunks.limit(8);
  if (found.error) throw found.error;
  let evidence = found.data ?? [];
  let semanticError: string | null = extraction.embedding_error;
  let semanticUsed = false;
  try {
    const vector = await embedDocumentText(input.question, "question");
    const matches = await db.rpc("match_document_chunks", {
      p_user_id: userId,
      p_extraction_id: extraction.id,
      p_query: JSON.stringify(vector),
      p_model: documentEmbeddingModel,
    });
    if (matches.error) throw matches.error;
    if (matches.data?.length) {
      semanticUsed = true;
      evidence = [
        ...new Map(
          [...matches.data, ...evidence].map((chunk) => [chunk.id, chunk]),
        ).values(),
      ].slice(0, 10);
    }
  } catch (error) {
    semanticError =
      error instanceof Error
        ? error.message
        : "Semantic search failed; indexed text search used.";
  }
  if (!evidence.length) {
    const fallback = await db
      .from("document_chunks")
      .select("id,ordinal,section_kind,location,content")
      .eq("user_id", userId)
      .eq("extraction_id", extraction.id)
      .order("ordinal")
      .limit(8);
    if (fallback.error) throw fallback.error;
    evidence = fallback.data ?? [];
  }
  const items = await db
    .from("extraction_items")
    .select("id,title,item_type,normalized_type,due_at,review_status,payload")
    .eq("user_id", userId)
    .eq(
      input.fileId ? "imported_file_id" : "imported_source_id",
      input.fileId ?? input.sourceId,
    )
    .is("deleted_at", null)
    .limit(80);
  if (items.error) throw items.error;
  // Manual corrections accompany model structure; never silently substitute AI for user decisions.
  structured = { ...structured, sourceText: undefined };
  const attendance =
    originalText
      ?.split(/\n+/)
      .filter((line) =>
        /attend|absence|absen|participat|required.*(?:present|lecture)|miss.*(?:lecture|class)/i.test(
          line,
        ),
      )
      .slice(0, 12) ?? [];
  return {
    documentType: extraction.classification,
    summary: extraction.summary,
    structured,
    items: items.data,
    chunks: evidence,
    attendanceSourceScan: {
      complete: Boolean(originalText),
      snippets: attendance,
    },
    analysisAt: extraction.created_at,
    retrieval: semanticUsed
      ? "Gemini semantic retrieval + indexed full-text"
      : "indexed full-text with question expansion",
    semanticError,
    groundingRule:
      "Answer from quoted source evidence with section/chunk id and calibrated confidence. Missing policy is not proof of mandatory/optional attendance. If relevant evidence was not retrieved, request a narrower search; do not invent an answer.",
    sourceTextVerified:
      structured.sourceTextVerified === true || Boolean(originalText),
  };
}
