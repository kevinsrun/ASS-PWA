import { createHash } from "crypto";
import {
  createCalendarEvent,
  type CalendarEventInput,
} from "@/lib/calendarEventService";
import { addMinutesToLabel } from "@/lib/dateTime";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { timeLabelToSql } from "@/lib/academicSchedule";

function client() {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  return supabase;
}

function stableLocalId(sourceKind: string, sourceId: string) {
  return (
    5_000_000_000 +
    createHash("sha256")
      .update(`${sourceKind}:${sourceId}`)
      .digest()
      .readUInt32BE(0)
  );
}

function zonedDate(value: string, timeZone: string) {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!match) return new Date(value);
  const desired = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (kind: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === kind)?.value ?? 0);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    guess += desired - represented;
  }
  return new Date(guess);
}

export async function createCanonicalEvent(
  userId: string,
  input: CalendarEventInput,
) {
  return createCalendarEvent(userId, input);
}

export async function createEventSourceLink(
  userId: string,
  input: {
    sourceKind: string;
    sourceId: string;
    destinationKind: string;
    destinationId: string;
  },
) {
  const { error } = await client().from("object_source_links").upsert(
    {
      user_id: userId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      destination_kind: input.destinationKind,
      destination_id: input.destinationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,source_kind,source_id,destination_kind" },
  );
  if (error)
    throw new Error(`Source link registration failed: ${error.message}`);
}

export async function markExtractionItemConverted(
  userId: string,
  itemId: string,
  links: Array<{ kind: string; id: string }>,
) {
  if (!links.length)
    throw new Error(
      "An extraction cannot be marked converted without a destination object.",
    );
  const now = new Date().toISOString();
  for (const link of links)
    await createEventSourceLink(userId, {
      sourceKind: "extraction_item",
      sourceId: itemId,
      destinationKind: link.kind,
      destinationId: link.id,
    });
  const { error } = await client()
    .from("extraction_items")
    .update({
      review_status: "committed",
      linked_entity_type: links.map((link) => link.kind).join(","),
      linked_entity_id: links.map((link) => link.id).join(","),
      conversion_error: null,
      updated_at: now,
    })
    .eq("id", itemId)
    .eq("user_id", userId);
  if (error)
    throw new Error(`Extraction conversion state failed: ${error.message}`);
}

export async function markExtractionItemIgnored(
  userId: string,
  itemId: string,
  reason = "Ignored by user",
) {
  const now = new Date().toISOString();
  const { error } = await client()
    .from("extraction_items")
    .update({
      review_status: "rejected",
      normalized_type: "ignore",
      ignore_future_imports: true,
      deleted_at: now,
      conversion_error: reason,
      updated_at: now,
    })
    .eq("id", itemId)
    .eq("user_id", userId);
  if (error)
    throw new Error(`Extraction ignore state failed: ${error.message}`);
}

export async function createRecurringAcademicEvent(
  userId: string,
  input: CalendarEventInput & {
    extractionItemId?: string;
    academicKind:
      | "lecture"
      | "lab"
      | "recitation"
      | "office_hours"
      | "conference"
      | "other";
    eventType?:
      | "lecture"
      | "lab"
      | "discussion"
      | "recitation"
      | "office_hour"
      | "exam_review"
      | "conference";
    dayIndexes: number[];
    dayPattern?: string;
    endDate?: string | null;
    courseId?: string | null;
    courseName?: string | null;
  },
) {
  if (!input.recurrenceRule)
    throw new Error("A recurring academic event requires a recurrence rule.");
  const event = await createCanonicalEvent(userId, {
    ...input,
    recurrence: "custom",
  });
  const { data, error } = await client()
    .from("academic_recurring_events")
    .upsert(
      {
        user_id: userId,
        extraction_item_id: input.extractionItemId ?? null,
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        canonical_event_id: event.canonicalEventId,
        title: input.title,
        academic_kind: input.academicKind,
        days_of_week: input.dayIndexes,
        course_id: input.courseId ?? null,
        course_name: input.courseName ?? null,
        event_type:
          input.eventType ??
          (input.academicKind === "office_hours"
            ? "office_hour"
            : input.academicKind === "other"
              ? "conference"
              : input.academicKind),
        day_pattern: input.dayPattern ?? input.dayIndexes.join(","),
        timezone: input.timeZone ?? "America/New_York",
        semester_start: input.date,
        semester_end: input.endDate ?? null,
        start_time: timeLabelToSql(input.startLabel || "9:00 AM"),
        end_time: timeLabelToSql(input.endLabel || "10:00 AM"),
        start_date: input.date,
        end_date: input.endDate ?? null,
        time_zone: input.timeZone ?? "America/New_York",
        location: input.location ?? null,
        recurrence_rule: input.recurrenceRule,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,source_kind,source_id" },
    )
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      `Academic recurrence registration failed: ${error?.message ?? "no row returned"}`,
    );
  await createEventSourceLink(userId, {
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    destinationKind: "academic_recurring_event",
    destinationId: String(data.id),
  });
  return { ...event, academicRecurringEventId: String(data.id) };
}

export async function createCanonicalTask(
  userId: string,
  input: {
    sourceKind: string;
    sourceId: string;
    title: string;
    dueDate?: string | null;
    priority?: "low" | "medium" | "high";
    duration?: number;
    tags?: string[];
    description?: string;
    dueAt?: string | null;
    localId?: number;
  },
) {
  const localId =
    input.localId ?? stableLocalId(input.sourceKind, input.sourceId);
  const { error } = await client()
    .from("todos")
    .upsert(
      {
        user_id: userId,
        local_id: localId,
        title: input.title,
        description: input.description ?? "",
        due_at: input.dueAt ?? null,
        source_type: input.sourceKind,
        source_id: input.sourceId,
        done: false,
        priority: input.priority ?? "medium",
        duration: input.duration ?? 60,
        due_date: input.dueDate ?? null,
        tags: input.tags ?? [input.sourceKind],
        recurrence: "none",
        subtasks: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,local_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Task registration failed: ${error.message}`);
  console.info(
    JSON.stringify({
      service: "object-creation",
      stage: "task-created",
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      localId,
    }),
  );
  return { localId };
}

export const createTask = createCanonicalTask;
export async function updateCanonicalTask(
  userId: string,
  localId: number,
  updates: {
    title?: string;
    description?: string;
    status?: "TODO" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "IGNORED";
    due_at?: string | null;
    start_after?: string | null;
    due_date?: string | null;
    priority?: "low" | "medium" | "high";
    duration?: number;
    tags?: string[];
    recurrence?: string;
    subtasks?: Array<{ id: number; title: string; done: boolean }>;
  },
) {
  const { data, error } = await client()
    .from("todos")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("local_id", localId)
    .is("deleted_at", null)
    .select("local_id")
    .single();
  if (error || !data) throw new Error("Task update failed");
  return data;
}
export async function completeCanonicalTask(userId: string, localId: number) {
  return updateCanonicalTask(userId, localId, { status: "COMPLETED" });
}
export async function deleteCanonicalTask(userId: string, localId: number) {
  const { error } = await client()
    .from("todos")
    .update({
      deleted_at: new Date().toISOString(),
      status: "IGNORED",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("local_id", localId);
  if (error) throw error;
}
export async function createDeadline(
  userId: string,
  input: {
    sourceKind: CalendarEventInput["sourceKind"];
    sourceId: string;
    title: string;
    dueAt: string;
    timeZone?: string;
    priority?: "low" | "medium" | "high";
    notes?: string;
    googleAccountId?: string;
    syncToGoogle?: boolean;
    dateOnly?: boolean;
    existingEvent?: Awaited<ReturnType<typeof createCanonicalEvent>>;
  },
) {
  const timeZone = input.timeZone || "America/New_York";
  const due = zonedDate(input.dueAt, timeZone);
  if (Number.isNaN(due.getTime()))
    throw new Error("Deadline registration requires a valid due date.");
  const date = due.toLocaleDateString("en-CA", { timeZone });
  const hasExplicitTime =
    input.dateOnly !== true &&
    !/T00:00(?::00)?(?:\.000)?(?:Z|[+-]\d{2}:\d{2})?$/.test(input.dueAt);
  const startLabel = hasExplicitTime
    ? due.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      })
    : "12:00 AM";
  const task = await createTask(userId, {
    sourceKind: input.sourceKind,
    sourceId: `${input.sourceId}:task`,
    title: input.title,
    dueDate: date,
    dueAt: due.toISOString(),
    description: input.notes ?? "",
    priority: input.priority,
    tags: ["deadline", input.sourceKind],
  });
  const event =
    input.existingEvent ??
    (await createCanonicalEvent(userId, {
      title: input.title,
      date,
      startLabel,
      endLabel: hasExplicitTime
        ? addMinutesToLabel(startLabel, 15)
        : "11:59 PM",
      allDay: !hasExplicitTime,
      timeZone,
      recurrence: "none",
      category:
        input.sourceKind === "gmail" ||
        input.sourceKind === "file" ||
        input.sourceKind === "drive"
          ? "school"
          : "other",
      priority: input.priority,
      notes: input.notes,
      sourceKind: input.sourceKind,
      sourceId: `${input.sourceId}:deadline`,
      syncToGoogle: input.syncToGoogle,
      googleAccountId: input.googleAccountId,
      blockingStatus: "free",
    }));
  const { data, error } = await client()
    .from("deadlines")
    .upsert(
      {
        user_id: userId,
        title: input.title,
        due_at: due.toISOString(),
        time_zone: timeZone,
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        todo_local_id: task.localId,
        canonical_event_id: event.canonicalEventId,
        status: "open",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,source_kind,source_id" },
    )
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      `Deadline registration failed: ${error?.message ?? "no row returned"}`,
    );
  console.info(
    JSON.stringify({
      service: "object-creation",
      stage: "deadline-created",
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      deadlineId: data.id,
    }),
  );
  return { id: String(data.id), task, event };
}

export async function createAssistantAction(
  userId: string,
  input: {
    sourceKind: string;
    sourceId: string;
    actionType: string;
    title: string;
    summary?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    payload?: Record<string, unknown>;
    status?: "pending" | "completed" | "dismissed" | "failed";
    errorMessage?: string | null;
  },
) {
  const supabase = client();
  const { data: existing, error: existingError } = await supabase
    .from("assistant_action_items")
    .select("id")
    .eq("user_id", userId)
    .eq("source_kind", input.sourceKind)
    .eq("source_id", input.sourceId)
    .eq("action_type", input.actionType)
    .maybeSingle();
  if (existingError)
    throw new Error(`Assistant action lookup failed: ${existingError.message}`);
  const { data, error } = await supabase
    .from("assistant_action_items")
    .upsert(
      {
        user_id: userId,
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        action_type: input.actionType,
        title: input.title,
        summary: input.summary ?? "",
        priority: input.priority ?? "normal",
        payload: input.payload ?? {},
        status: input.status ?? "pending",
        error_message: input.errorMessage ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,source_kind,source_id,action_type" },
    )
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      `Assistant action registration failed: ${error?.message ?? "no row returned"}`,
    );
  return { id: String(data.id), created: !existing };
}

export async function createEmailDraft(
  userId: string,
  input: {
    googleAccountId: string;
    emailSuggestionId: number | null;
    threadId?: string | null;
    inReplyToMessageId?: string | null;
    recipient?: string | null;
    subject: string;
    body: string;
    context?: Record<string, unknown>;
  },
) {
  const supabase = client();
  const { data: existing, error: existingError } = input.emailSuggestionId
    ? await supabase
        .from("email_drafts")
        .select("id,status")
        .eq("user_id", userId)
        .eq("email_suggestion_id", input.emailSuggestionId)
        .maybeSingle()
    : { data: null, error: null };
  if (existingError)
    throw new Error(`Email draft lookup failed: ${existingError.message}`);
  // Retries/reanalysis must never replace a generated or user-reviewed draft.
  if (existing) return { id: String(existing.id), created: false };
  const { data, error } = await supabase
    .from("email_drafts")
    .upsert(
      {
        user_id: userId,
        google_account_id: input.googleAccountId,
        email_suggestion_id: input.emailSuggestionId,
        thread_id: input.threadId ?? null,
        in_reply_to_message_id: input.inReplyToMessageId ?? null,
        recipient: input.recipient ?? null,
        subject: input.subject,
        body: input.body,
        context_snapshot: input.context ?? {},
        status: "ready",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email_suggestion_id" },
    )
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      `Email draft registration failed: ${error?.message ?? "no row returned"}`,
    );
  return { id: String(data.id), created: !existing };
}

export async function createEventDecision(
  userId: string,
  input: {
    sourceKind: "email" | "file";
    sourceId: string;
    decision?:
      | "going"
      | "maybe"
      | "not_going"
      | "add_to_calendar"
      | "ignore"
      | "approve"
      | "reject";
    tentative?: boolean;
    context?: Record<string, unknown>;
  },
) {
  const { data, error } = await client()
    .from("event_decisions")
    .upsert(
      {
        user_id: userId,
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        decision: input.decision ?? "maybe",
        tentative: input.tentative ?? true,
        context: input.context ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,source_kind,source_id" },
    )
    .select("id")
    .single();
  if (error || !data)
    throw new Error(
      `Event decision registration failed: ${error?.message ?? "no row returned"}`,
    );
  return { id: String(data.id) };
}

export async function recordClassificationFeedback(
  userId: string,
  input: {
    sourceType: string;
    sourceId: string;
    originalText?: string;
    predictedLabel?: string | null;
    confidence?: number | null;
    correctedLabel?: string | null;
    userAction: string;
    context?: Record<string, unknown>;
  },
) {
  const { error } = await client()
    .from("classification_feedback")
    .insert({
      user_id: userId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      original_text: input.originalText ?? "",
      ai_predicted_label: input.predictedLabel ?? null,
      ai_confidence: input.confidence ?? null,
      user_corrected_label: input.correctedLabel ?? null,
      user_action: input.userAction,
      context_json: input.context ?? {},
    });
  if (error)
    throw new Error(
      `Classification feedback registration failed: ${error.message}`,
    );
  const corrected =
    input.correctedLabel ??
    (input.userAction === "reject" ||
    input.userAction === "ignore" ||
    input.userAction === "dismiss"
      ? "ignore"
      : input.predictedLabel);
  if (corrected) {
    const ruleKey = createHash("sha256")
      .update(
        `${input.sourceType}:${input.predictedLabel ?? "unknown"}:${corrected}`,
      )
      .digest("hex")
      .slice(0, 32);
    const { data: current } = await client()
      .from("classification_rules")
      .select("evidence_count")
      .eq("user_id", userId)
      .eq("rule_key", ruleKey)
      .maybeSingle();
    const evidenceCount = Number(current?.evidence_count ?? 0) + 1;
    const { error: ruleError } = await client()
      .from("classification_rules")
      .upsert(
        {
          user_id: userId,
          rule_key: ruleKey,
          rule_text: `For ${input.sourceType} items resembling “${(input.originalText ?? "this item").slice(0, 100)}”, prefer ${corrected} over ${input.predictedLabel ?? "unknown"}.`,
          confidence: Math.min(0.95, 0.55 + evidenceCount * 0.08),
          evidence_count: evidenceCount,
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,rule_key" },
      );
    if (ruleError)
      throw new Error(
        `Classification rule update failed: ${ruleError.message}`,
      );
  }
}
