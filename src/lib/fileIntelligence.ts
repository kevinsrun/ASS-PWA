import { createHash } from "crypto";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";
import { extractOfficeText } from "@/lib/officeText";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const fileClassifications = ["syllabus", "assignment", "lecture_notes", "reading", "dataset", "research_paper", "financial_document", "form", "schedule", "project_file", "unknown"] as const;
export const extractionItemTypes = ["course", "assignment", "deadline", "event", "office_hours", "policy", "material", "reading", "dataset_finding", "task", "project_update"] as const;
type FileClassification = typeof fileClassifications[number];
type ExtractionItemType = typeof extractionItemTypes[number];

export type FileAnalysis = {
  classification: FileClassification;
  confidence: number;
  summary: string;
  structuredData: Record<string, unknown>;
  items: Array<{ type: ExtractionItemType; title: string; description: string; dueAt: string | null; durationMinutes: number | null; confidence: number; required: boolean; payload: Record<string, unknown> }>;
};

function clamp(value: unknown) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function safeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function cleanJson(text: string) { return text.replace(/^```json\s*|\s*```$/g, "").trim(); }

function textFor(file: { name: string; mimeType: string; buffer: Buffer }) {
  if (file.mimeType.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name)) return file.buffer.toString("utf8").slice(0, 180_000);
  if (file.mimeType.includes("officedocument")) return extractOfficeText(file.buffer, file.mimeType);
  return null;
}

export async function analyzeFile(file: { name: string; mimeType: string; buffer: Buffer }): Promise<FileAnalysis> {
  const prompt = `You are the file intelligence layer of ASS, a private life operating system. Analyze the attached file without inventing facts.
Return only strict JSON with this shape:
{"classification":"syllabus|assignment|lecture_notes|reading|dataset|research_paper|financial_document|form|schedule|project_file|unknown","confidence":0.0,"summary":"concise","structuredData":{},"items":[{"type":"course|assignment|deadline|event|office_hours|policy|material|reading|dataset_finding|task|project_update","title":"...","description":"...","dueAt":"ISO-8601 or null","durationMinutes":60,"confidence":0.0,"required":false,"payload":{}}]}
For syllabi, structuredData should include courseName, professor, officeHours, gradingPolicy, attendancePolicy, examDates, assignmentSchedule, readingSchedule, latePolicy, requiredMaterials, and importantDeadlines when present.
For assignments, include title, dueDate, instructions, estimatedMinutes, difficulty, deliverables, rubric, and submissionMethod.
For datasets, include columns, rowCount, schema, possibleUses, summaryStatistics, and dataQualityIssues. Create only actionable or genuinely useful items. File name: ${file.name}. Current date: ${new Date().toISOString().slice(0, 10)}.`;
  const extractedText = textFor(file);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  if (extractedText !== null) parts.push({ text: `\nFile content:\n${extractedText}` });
  else parts.push({ inlineData: { mimeType: file.mimeType, data: file.buffer.toString("base64") } });
  let result;
  try { result = await getGeminiModel().generateContent(parts); }
  catch (error) {
    if (!String(error).includes("429")) throw error;
    rotateGeminiKey();
    result = await getGeminiModel().generateContent(parts);
  }
  const raw = JSON.parse(cleanJson(result.response.text())) as Record<string, unknown>;
  const classification = fileClassifications.includes(raw.classification as FileClassification) ? raw.classification as FileClassification : "unknown";
  const items = Array.isArray(raw.items) ? raw.items.slice(0, 80).flatMap((value) => {
    const item = value as Record<string, unknown>;
    if (!extractionItemTypes.includes(item.type as ExtractionItemType) || !String(item.title ?? "").trim()) return [];
    return [{ type: item.type as ExtractionItemType, title: String(item.title).slice(0, 240), description: String(item.description ?? "").slice(0, 4000), dueAt: safeDate(item.dueAt), durationMinutes: item.durationMinutes ? Math.max(5, Math.min(10080, Number(item.durationMinutes))) : null, confidence: clamp(item.confidence), required: Boolean(item.required), payload: typeof item.payload === "object" && item.payload ? item.payload as Record<string, unknown> : {} }];
  }) : [];
  return { classification, confidence: clamp(raw.confidence), summary: String(raw.summary ?? "").slice(0, 2000), structuredData: typeof raw.structuredData === "object" && raw.structuredData ? raw.structuredData as Record<string, unknown> : {}, items };
}

function stableLocalId(itemId: string, kind: string) {
  return 7_000_000_000 + createHash("sha256").update(`${itemId}:${kind}`).digest().readUInt32BE(0);
}

export async function commitExtractionItem(userId: string, itemId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: item, error } = await supabase.from("extraction_items").select("*").eq("id", itemId).eq("user_id", userId).single();
  if (error || !item) throw error ?? new Error("Extraction item not found");
  if (item.review_status === "committed") return item;
  const linkedTypes: string[] = [];
  const linkedIds: string[] = [];
  if (["assignment", "deadline", "task", "project_update"].includes(String(item.item_type))) {
    const localId = stableLocalId(itemId, "task");
    const { error: todoError } = await supabase.from("todos").upsert({ user_id: userId, local_id: localId, title: item.title, done: false, priority: item.required ? "high" : "medium", duration: item.duration_minutes ?? 60, due_date: item.due_at ? String(item.due_at).slice(0, 10) : null, tags: ["file", item.item_type], recurrence: "none", subtasks: [], updated_at: new Date().toISOString() }, { onConflict: "user_id,local_id" });
    if (todoError) throw todoError;
    linkedTypes.push("todo"); linkedIds.push(String(localId));
  }
  if (item.due_at && ["assignment", "deadline", "event", "office_hours"].includes(String(item.item_type))) {
    const at = new Date(item.due_at);
    const allDay = at.getUTCHours() === 0 && at.getUTCMinutes() === 0;
    const localId = stableLocalId(itemId, "plan");
    const startLabel = allDay ? "12:00 AM" : at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    const end = new Date(at.getTime() + (item.duration_minutes ?? 60) * 60_000);
    const endLabel = allDay ? "11:59 PM" : end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    const { error: planError } = await supabase.from("plans").upsert({ user_id: userId, local_id: localId, title: item.title, date: at.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), start_label: startLabel, end_label: endLabel, recurrence: "none", category: "school", priority: item.required ? "high" : "medium", notes: item.description, source: "ass", all_day: allDay, updated_at: new Date().toISOString() }, { onConflict: "user_id,local_id" });
    if (planError) throw planError;
    linkedTypes.push("plan"); linkedIds.push(String(localId));
  }
  if (item.item_type === "assignment") {
    const { data: imported, error: importedError } = await supabase.from("imported_files").select("linked_course_id").eq("id", item.imported_file_id).eq("user_id", userId).single();
    if (importedError) throw importedError;
    if (imported?.linked_course_id) {
      const { data: course, error: courseError } = await supabase.from("academic_courses").select("canvas_id").eq("id", imported.linked_course_id).eq("user_id", userId).single();
      if (courseError || !course) throw courseError ?? new Error("Linked course not found");
      const assignmentId = stableLocalId(itemId, "academic-assignment");
      const payload = typeof item.payload === "object" && item.payload ? item.payload as Record<string, unknown> : {};
      const difficulty = ["low", "medium", "high"].includes(String(payload.difficulty)) ? String(payload.difficulty) : "medium";
      const { data: assignment, error: assignmentError } = await supabase.from("academic_assignments").upsert({
        user_id: userId, course_id: imported.linked_course_id, canvas_id: assignmentId, course_canvas_id: course.canvas_id,
        title: item.title, description_html: item.description, due_at: item.due_at, estimated_minutes: item.duration_minutes ?? 60,
        difficulty, priority: item.required ? "high" : "medium", todo_local_id: stableLocalId(itemId, "task"),
        plan_local_id: item.due_at ? stableLocalId(itemId, "plan") : null,
        raw_data: { source: "file", extractionItemId: itemId, ...payload }, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,canvas_id" }).select("id").single();
      if (assignmentError || !assignment) throw assignmentError ?? new Error("Could not create academic assignment");
      linkedTypes.push("academic_assignment"); linkedIds.push(String(assignment.id));
    }
  }
  const now = new Date().toISOString();
  const linkedType = linkedTypes.length ? linkedTypes.join(",") : null;
  const linkedId = linkedIds.length ? linkedIds.join(",") : null;
  const { error: updateError } = await supabase.from("extraction_items").update({ review_status: "committed", linked_entity_type: linkedType, linked_entity_id: linkedId, updated_at: now }).eq("id", itemId).eq("user_id", userId);
  if (updateError) throw updateError;
  return { ...item, review_status: "committed", linked_entity_type: linkedType, linked_entity_id: linkedId };
}
