import { deriveAcademicSchedule, parseTimeRange } from "@/lib/academicSchedule";
import { labelToMinutes } from "@/lib/dateTime";
import type { FileAnalysis } from "@/lib/fileIntelligence";
export const syllabusBuckets = [
  "ACTIONABLE",
  "SCHEDULED",
  "DEADLINE",
  "POLICY",
  "REFERENCE",
  "UNCERTAIN",
] as const;
export const syllabusSubtypes = [
  "lecture",
  "lab",
  "discussion",
  "exam",
  "quiz",
  "office_hours",
  "assignment",
  "project",
  "deadline",
  "attendance",
  "grading",
  "late_work",
  "material",
  "contact",
  "reference",
  "task",
] as const;
export function syllabusLabel(bucket: unknown, subtype: unknown) {
  if (bucket === "UNCERTAIN") return "UNKNOWN";
  if (bucket === "POLICY") return "POLICY";
  if (bucket === "REFERENCE")
    return subtype === "contact" ? "CONTACT_INFO" : "REFERENCE";
  if (bucket === "SCHEDULED")
    return subtype === "office_hours"
      ? "OFFICE_HOURS"
      : ["lecture", "lab", "discussion"].includes(String(subtype))
        ? "COURSE_SCHEDULE"
        : "CALENDAR_EVENT";
  if (bucket === "DEADLINE")
    return subtype === "assignment" ? "ASSIGNMENT" : "DEADLINE";
  return bucket === "ACTIONABLE" ? "TASK" : "UNKNOWN";
}
export function groundedTermDate(value: unknown, text: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    return null;
  if (text.includes(value)) return value;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[Number(value.slice(5, 7)) - 1],
    day = Number(value.slice(8, 10));
  return new RegExp(
    `\\b${month}\\w*\\s+0?${day}(?:st|nd|rd|th)?[,\\s]+${value.slice(0, 4)}\\b`,
    "i",
  ).test(text)
    ? value
    : null;
}
export function refineSyllabusItem(
  item: FileAnalysis["items"][number],
  structured: Record<string, unknown>,
) {
  const subtype = String(item.payload.subtype ?? "reference");
  item.payload.bucket = [
    "policy",
    "reference",
    "unknown",
    "contact_info",
    "office_hours",
  ].includes(item.type)
    ? item.type === "policy"
      ? "POLICY"
      : item.type === "unknown"
        ? "UNCERTAIN"
        : "REFERENCE"
    : ["assignment", "deadline"].includes(item.type)
      ? "DEADLINE"
      : item.normalizedType === "calendar_event"
        ? "SCHEDULED"
        : "ACTIONABLE";
  if (subtype === "office_hours" || item.type === "office_hours") {
    item.normalizedType = "reference";
    item.required = false;
    item.optionality = "optional";
    item.payload.autoCreate = false;
    return item;
  }
  const evidence = String(item.payload.evidence_text ?? "");
  const failures = [...((item.payload.guardrailFailures as string[]) ?? [])];
  if (
    item.dueAt &&
    !String(structured.sourceYearEvidence ?? "").includes(
      item.dueAt.slice(0, 4),
    )
  )
    failures.push("Extracted year is not grounded in the document term/source");
  if (
    (item.dueAt && Number(item.dueAt.slice(0, 4)) < new Date().getFullYear()) ||
    (typeof structured.semesterEnd === "string" &&
      Date.parse(structured.semesterEnd) < Date.now() - 86400000)
  ) {
    item.normalizedType = "reference";
    item.payload.bucket = "REFERENCE";
    item.payload.autoCreate = false;
    item.classificationReason +=
      " · Historical course dates retained for reference.";
    return item;
  }
  if (item.normalizedType === "calendar_event") {
    const recurring = deriveAcademicSchedule({
      payload: item.payload,
      description: item.description,
      structuredData: structured,
    });
    const hasRange =
      /\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:–|—|-|to)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/i.test(
        evidence,
      );
    const range = hasRange ? parseTimeRange(evidence) : null;
    if (range) {
      const duration =
        labelToMinutes(range.endLabel) - labelToMinutes(range.startLabel);
      if (duration <= 0 || duration > 12 * 60)
        failures.push("Source time range is invalid or ambiguous");
      else item.durationMinutes = duration;
      if (item.dueAt) {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: item.timeZone || "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(item.dueAt));
        const minutes =
          Number(parts.find((part) => part.type === "hour")?.value) * 60 +
          Number(parts.find((part) => part.type === "minute")?.value);
        if (minutes !== labelToMinutes(range.startLabel))
          failures.push(
            "Extracted start time contradicts the source time range",
          );
      }
    }
    if (["exam", "quiz"].includes(subtype) && item.dueAt && !hasRange) {
      // Date-only exams are free deadline markers, never an invented one-hour commitment.
      item.type = "deadline";
      item.normalizedType = "deadline";
      item.required = true;
      item.payload.bucket = "DEADLINE";
    } else if (
      !hasRange ||
      (!item.dueAt && (!recurring || !recurring.endDate))
    ) {
      failures.push(
        "Schedule needs a complete source time range and grounded semester bounds or a specific dated meeting",
      );
      item.normalizedType = "reference";
      item.payload.bucket = "UNCERTAIN";
      item.confidence = Math.min(item.confidence, 0.89);
    }
  }
  if (
    failures.length &&
    ["calendar_event", "deadline", "task"].includes(item.normalizedType)
  ) {
    item.payload.bucket = "UNCERTAIN";
    item.confidence = Math.min(item.confidence, 0.89);
  }
  item.payload.guardrailFailures = failures;
  item.classificationReason = [item.classificationReason, ...failures]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1000);
  item.payload.autoCreate =
    item.payload.evidenceVerified === true &&
    item.confidence >= 0.94 &&
    failures.length === 0 &&
    (item.normalizedType === "calendar_event" ||
      item.normalizedType === "deadline" ||
      (item.normalizedType === "task" && item.required));
  return item;
}
export function structuredSyllabus(
  items: FileAnalysis["items"],
  document: Record<string, unknown>,
) {
  const rows = (types: string[]) =>
    items
      .filter((item) => types.includes(String(item.payload.subtype)))
      .map((item) => ({
        title: item.title,
        description: item.description,
        date: item.dueAt,
        schedule: item.payload.schedule,
        confidence: item.confidence,
        bucket: item.payload.bucket,
        evidence: item.payload.evidence_text,
        sourceSection: item.payload.source_location,
        optional: item.optionality === "optional",
      }));
  return {
    course: {
      name: document.courseName ?? null,
      code: document.courseCode ?? null,
      instructor: document.professor ?? null,
      term: document.term ?? null,
    },
    meetingTimes: rows(["lecture"]),
    labs: rows(["lab"]),
    discussions: rows(["discussion"]),
    officeHours: rows(["office_hours"]),
    exams: rows(["exam", "quiz"]),
    assignments: rows(["assignment"]),
    projects: rows(["project"]),
    deadlines: rows(["deadline"]),
    attendancePolicy: rows(["attendance"]),
    gradingPolicy: rows(["grading"]),
    latePolicy: rows(["late_work"]),
    requiredMaterials: rows(["material"]),
    importantReference: rows(["contact", "reference"]),
  };
}
