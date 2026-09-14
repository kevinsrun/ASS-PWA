import { createHash } from "crypto";
import { createCanonicalEvent, createDeadline, createRecurringAcademicEvent, createTask, markExtractionItemConverted } from "@/lib/objectCreation";
import { deriveAcademicSchedule } from "@/lib/academicSchedule";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";
import { extractOfficeText } from "@/lib/officeText";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const fileClassifications = ["syllabus", "assignment", "lecture_notes", "reading", "dataset", "research_paper", "financial_document", "form", "schedule", "project_file", "unknown"] as const;
export const extractionItemTypes = ["course", "assignment", "deadline", "event", "office_hours", "policy", "material", "reading", "dataset_finding", "task", "project_update"] as const;
export const normalizedExtractionTypes = ["course", "task", "project", "calendar_event", "deadline", "study_block", "reference", "ignore"] as const;
type FileClassification = typeof fileClassifications[number];
type ExtractionItemType = typeof extractionItemTypes[number];

export type FileAnalysis = {
  classification: FileClassification;
  confidence: number;
  summary: string;
  structuredData: Record<string, unknown>;
  items: Array<{ type: ExtractionItemType; normalizedType: typeof normalizedExtractionTypes[number]; title: string; description: string; dueAt: string | null; durationMinutes: number | null; timeZone: string | null; recurrenceRule: string | null; location: string | null; confidence: number; required: boolean; payload: Record<string, unknown> }>;
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
{"classification":"syllabus|assignment|lecture_notes|reading|dataset|research_paper|financial_document|form|schedule|project_file|unknown","confidence":0.0,"summary":"concise","structuredData":{},"items":[{"type":"course|assignment|deadline|event|office_hours|policy|material|reading|dataset_finding|task|project_update","normalizedType":"course|task|project|calendar_event|deadline|study_block|reference|ignore","title":"...","description":"...","dueAt":"ISO-8601 or null","durationMinutes":60,"timeZone":"IANA zone or null","recurrenceRule":"RRULE or null","location":"location or null","confidence":0.0,"required":false,"payload":{}}]}
For syllabi, structuredData should include courseName, professor, officeHours, gradingPolicy, attendancePolicy, examDates, assignmentSchedule, readingSchedule, latePolicy, requiredMaterials, and importantDeadlines when present.
For assignments, include title, dueDate, instructions, estimatedMinutes, difficulty, deliverables, rubric, and submissionMethod.
For datasets, include columns, rowCount, schema, possibleUses, summaryStatistics, and dataQualityIssues.
Normalize class meetings, exams, office hours, appointments, and dated events as calendar_event. Normalize assignments and project due dates as deadline. Normalize readings without a fixed time as task, and scheduled study sessions as study_block. Preserve explicit time zones, locations, and recurrence rules. Never invent a date or time; items without one must remain tasks or references for review.
Create only actionable or genuinely useful items. File name: ${file.name}. Current date: ${new Date().toISOString().slice(0, 10)}.`;
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
    const dueAt = safeDate(item.dueAt);
    const normalizedType = normalizedExtractionTypes.includes(item.normalizedType as typeof normalizedExtractionTypes[number]) ? item.normalizedType as typeof normalizedExtractionTypes[number] : defaultNormalizedType(String(item.type), dueAt);
    return [{ type: item.type as ExtractionItemType, normalizedType, title: String(item.title).slice(0, 240), description: String(item.description ?? "").slice(0, 4000), dueAt, durationMinutes: item.durationMinutes ? Math.max(5, Math.min(10080, Number(item.durationMinutes))) : null, timeZone: item.timeZone ? String(item.timeZone).slice(0, 100) : null, recurrenceRule: item.recurrenceRule ? String(item.recurrenceRule).slice(0, 500) : null, location: item.location ? String(item.location).slice(0, 500) : null, confidence: clamp(item.confidence), required: Boolean(item.required), payload: typeof item.payload === "object" && item.payload ? item.payload as Record<string, unknown> : {} }];
  }) : [];
  return { classification, confidence: clamp(raw.confidence), summary: String(raw.summary ?? "").slice(0, 2000), structuredData: typeof raw.structuredData === "object" && raw.structuredData ? raw.structuredData as Record<string, unknown> : {}, items };
}

function stableLocalId(itemId: string, kind: string) {
  return 7_000_000_000 + createHash("sha256").update(`${itemId}:${kind}`).digest().readUInt32BE(0);
}

function defaultNormalizedType(itemType: string, dueAt: string | null) {
  if (["event", "office_hours"].includes(itemType)) return "calendar_event";
  if (["assignment", "deadline"].includes(itemType) && dueAt) return "deadline";
  if (["assignment", "task", "reading"].includes(itemType)) return "task";
  if (itemType === "project_update") return dueAt ? "deadline" : "project";
  if (itemType === "course") return "course";
  return "reference";
}

export async function commitExtractionItem(userId: string, itemId: string, override?: { normalizedType?: string; force?: boolean }) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: item, error } = await supabase.from("extraction_items").select("*").eq("id", itemId).eq("user_id", userId).single();
  if (error || !item) throw error ?? new Error("Extraction item not found");
  if (item.review_status === "committed" && item.linked_entity_id && !override?.force) return item;
  const normalizedType = normalizedExtractionTypes.includes(override?.normalizedType as typeof normalizedExtractionTypes[number])
    ? String(override?.normalizedType)
    : String(item.normalized_type ?? defaultNormalizedType(String(item.item_type), item.due_at ? String(item.due_at) : null));
  console.info(JSON.stringify({ service: "file-conversion", stage: "selected", itemId, extractedType: item.item_type, normalizedType, dueAt: item.due_at ?? null }));
  const { data: extraction } = item.extraction_id
    ? await supabase.from("file_extractions").select("structured_data").eq("id", item.extraction_id).maybeSingle()
    : { data: null };
  const { data: importedFile } = item.imported_file_id
    ? await supabase.from("imported_files").select("linked_course_id").eq("id", item.imported_file_id).eq("user_id", userId).maybeSingle()
    : { data: null };
  const payload = typeof item.payload === "object" && item.payload ? item.payload as Record<string, unknown> : {};
  const academicSchedule = normalizedType === "calendar_event" ? deriveAcademicSchedule({
    payload, description: item.description, recurrenceRule: item.recurrence_rule,
    dueAt: item.due_at, durationMinutes: item.duration_minutes,
    structuredData: extraction?.structured_data as Record<string, unknown> | undefined, createdAt: item.created_at,
  }) : null;
  if (["calendar_event", "deadline", "study_block"].includes(normalizedType) && !item.due_at && !academicSchedule) {
    throw new Error(`A date/time or complete recurring schedule is required before this ${normalizedType.replaceAll("_", " ")} can be registered.`);
  }
  const linkedTypes: string[] = [];
  const linkedIds: string[] = [];
  let taskLocalId: number | null = null;
  const createsTask = ["task", "project"].includes(normalizedType);
  if (createsTask) {
    const task = await createTask(userId, { sourceKind: item.imported_file_id ? "file" : "text", sourceId: itemId, title: String(item.title), dueDate: item.due_at ? String(item.due_at).slice(0, 10) : null, priority: item.required ? "high" : "medium", duration: item.duration_minutes ?? 60, tags: ["file", String(item.item_type)] });
    taskLocalId = task.localId;
    linkedTypes.push("todo"); linkedIds.push(String(task.localId));
  }
  let calendarResult: Awaited<ReturnType<typeof createCanonicalEvent>> | null = null;
  if ((item.due_at || academicSchedule) && ["calendar_event", "deadline", "study_block"].includes(normalizedType)) {
    const at = new Date(item.due_at ?? `${academicSchedule!.startDate}T12:00:00Z`);
    const allDay = at.getUTCHours() === 0 && at.getUTCMinutes() === 0;
    const startLabel = allDay ? "12:00 AM" : at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    const end = new Date(at.getTime() + (item.duration_minutes ?? 60) * 60_000);
    const endLabel = allDay ? "11:59 PM" : end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
    const { count: googleAccounts } = await supabase.from("google_tokens").select("id", { count: "exact", head: true }).eq("user_id", userId);
    const recurrenceRule = academicSchedule?.recurrenceRule ?? (String(item.recurrence_rule ?? payload.recurrenceRule ?? "").trim() || null);
    const calendarPayload = {
      title: String(item.title), date: academicSchedule?.startDate ?? at.toLocaleDateString("en-CA", { timeZone: String(item.time_zone ?? "America/New_York") }),
      startLabel: academicSchedule?.startLabel ?? startLabel, endLabel: academicSchedule?.endLabel ?? endLabel, allDay: academicSchedule ? false : allDay, timeZone: String(item.time_zone ?? "America/New_York"), recurrence: recurrenceRule ? "custom" as const : "none" as const,
      recurrenceRule, category: "school" as const, priority: item.required ? "high" as const : "medium" as const,
      notes: String(item.description ?? ""), location: String(item.location ?? payload.location ?? "") || null,
      sourceKind: item.imported_file_id ? "file" as const : "text" as const, sourceId: itemId, syncToGoogle: Boolean(googleAccounts),
    };
    console.info(JSON.stringify({ service: "file-conversion", stage: "calendar-payload", itemId, payload: calendarPayload }));
    if (normalizedType === "deadline") {
      const deadline = await createDeadline(userId, { sourceKind: calendarPayload.sourceKind, sourceId: itemId, title: String(item.title), dueAt: String(item.due_at), timeZone: calendarPayload.timeZone, priority: calendarPayload.priority, notes: calendarPayload.notes, syncToGoogle: Boolean(googleAccounts) });
      calendarResult = deadline.event;
      taskLocalId = deadline.task.localId;
      linkedTypes.push("todo", "deadline"); linkedIds.push(String(deadline.task.localId), deadline.id);
    } else if (academicSchedule) {
      const academicKind = item.item_type === "office_hours" ? "office_hours" : /lab/i.test(item.title) ? "lab" : /recitation/i.test(item.title) ? "recitation" : /conference/i.test(item.title) ? "conference" : "lecture";
      const structured = extraction?.structured_data as Record<string, unknown> | undefined;
      const recurring = await createRecurringAcademicEvent(userId, { ...calendarPayload, extractionItemId: itemId, academicKind, dayIndexes: academicSchedule.dayIndexes, dayPattern: String(payload.schedule ?? payload.days ?? academicSchedule.dayCodes.join(",")), endDate: academicSchedule.endDate, courseId: importedFile?.linked_course_id ? String(importedFile.linked_course_id) : null, courseName: structured?.courseName ? String(structured.courseName) : null });
      calendarResult = recurring;
      linkedTypes.push("academic_recurring_event"); linkedIds.push(recurring.academicRecurringEventId);
    } else {
      calendarResult = await createCanonicalEvent(userId, calendarPayload);
    }
    linkedTypes.push("canonical_event"); linkedIds.push(calendarResult.canonicalEventId);
  }
  if (item.imported_file_id && item.item_type === "assignment" && ["task", "project", "deadline"].includes(normalizedType)) {
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
        difficulty, priority: item.required ? "high" : "medium", todo_local_id: taskLocalId,
        plan_local_id: calendarResult?.planLocalId ?? null,
        raw_data: { source: "file", extractionItemId: itemId, ...payload }, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,canvas_id" }).select("id").single();
      if (assignmentError || !assignment) throw assignmentError ?? new Error("Could not create academic assignment");
      linkedTypes.push("academic_assignment"); linkedIds.push(String(assignment.id));
    }
  }
  if (!linkedTypes.length && !["reference", "ignore", "course"].includes(normalizedType)) {
    throw new Error(`No destination object was created for ${normalizedType}.`);
  }
  const links = linkedTypes.map((kind, index) => ({ kind, id: linkedIds[index] }));
  if (links.length) await markExtractionItemConverted(userId, itemId, links);
  else {
    const { error: updateError } = await supabase.from("extraction_items").update({ review_status: "committed", normalized_type: normalizedType, linked_entity_type: normalizedType, linked_entity_id: itemId, conversion_error: null, updated_at: new Date().toISOString() }).eq("id", itemId).eq("user_id", userId);
    if (updateError) throw updateError;
  }
  const linkedType = linkedTypes.length ? linkedTypes.join(",") : normalizedType;
  const linkedId = linkedIds.length ? linkedIds.join(",") : itemId;
  const updated = { id: itemId, review_status: "committed", normalized_type: normalizedType, linked_entity_type: linkedType, linked_entity_id: linkedId };
  console.info(JSON.stringify({ service: "file-conversion", stage: "committed", itemId, normalizedType, linkedType, linkedId, googleSynced: calendarResult?.googleSynced ?? false, googleError: calendarResult?.googleError ?? null, database: updated }));
  return { ...item, ...updated, calendarResult };
}
