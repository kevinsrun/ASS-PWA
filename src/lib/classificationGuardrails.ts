import { hasTaskInstruction } from "@/lib/taskEvidence";
export const factualLabels = [
  "REFERENCE",
  "CALENDAR_EVENT",
  "DEADLINE",
  "TASK",
  "REQUIRED_FORM",
  "READING",
  "ASSIGNMENT",
  "POLICY",
  "CONTACT_INFO",
  "OFFICE_HOURS",
  "COURSE_SCHEDULE",
  "PROJECT",
  "IGNORE",
  "UNKNOWN",
] as const;
export type FactualLabel = (typeof factualLabels)[number];
export type DocumentSection = {
  id: string;
  kind: string;
  text: string;
  location: string;
};
const squash = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();
const timeEvidence = /\b(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?))\b/i;
const dayEvidence =
  /\b(?:MWF|TTh|TR|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i;
const dateEvidence =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2})\b/i;
const meetingEvidence =
  /\b(?:lecture|lab|meets?|meeting|session|appointment|exam|conference|seminar|office hours|recitation|discussion|workshop|class)\b/i;
const actionEvidence =
  /\b(?:submit|complete|register|apply|pay|reply|respond|prepare|read|write|finish|upload|fill|sign|return|review|due|deadline|must|required)\b/i;

export function segmentDocument(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let kind = "miscellaneous",
    lines: string[] = [],
    start = 1;
  const flush = () => {
    if (lines.join("\n").trim())
      sections.push({
        id: `section-${sections.length + 1}`,
        kind,
        text: lines.join("\n"),
        location: `lines ${start}–${start + lines.length - 1}`,
      });
    lines = [];
  };
  text.split(/\r?\n/).forEach((line, index) => {
    const heading = line
      .replace(/^\s*#+\s*/, "")
      .trim()
      .replace(/:$/, "");
    let next: string | null = null;
    if (heading.length <= 90) {
      if (
        /^(course schedule|weekly schedule|meeting times|class meetings|schedule|exams?|office hours)(\b.*)?$/i.test(
          heading,
        )
      )
        next = "schedule";
      else if (
        /^(assignments?|homework|deliverables|deadlines)(\b.*)?$/i.test(heading)
      )
        next = "assignments";
      else if (
        /^(grading|attendance|policies|late policy|academic integrity)(\b.*)?$/i.test(
          heading,
        )
      )
        next = "policies";
      else if (
        /^(required materials|textbooks?|resources|readings?)(\b.*)?$/i.test(
          heading,
        )
      )
        next = "resources";
      else if (/^(contact|instructor|professor)(\b.*)?$/i.test(heading))
        next = "contact_info";
      else if (
        /^(course description|learning objectives|course info|overview|abstract|introduction|background)(\b.*)?$/i.test(
          heading,
        )
      )
        next = "reference";
    }
    if (next || lines.join("\n").length + line.length > 6000) {
      flush();
      start = index + 1;
      if (next) kind = next;
    }
    lines.push(line);
  });
  flush();
  return sections;
}

export function validateExtractedItem(input: {
  label: string;
  confidence: number;
  evidenceText: string;
  dueAt?: string | null;
  required?: boolean;
  documentType: string;
  section: DocumentSection;
  evidenceVerified?: boolean;
  subtype?: string;
}) {
  let label: FactualLabel = factualLabels.includes(input.label as FactualLabel)
    ? (input.label as FactualLabel)
    : "UNKNOWN";
  let confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));
  const evidence = input.evidenceText.trim();
  const quoted =
    evidence.length >= 8 &&
    squash(input.section.text).includes(squash(evidence));
  const failures: string[] = [];
  if (!quoted) {
    failures.push("Evidence is missing or is not a verbatim source quote");
    label = "UNKNOWN";
    confidence = Math.min(confidence, 0.49);
  }
  if (
    ["reference", "resources", "contact_info", "policies"].includes(
      input.section.kind,
    ) &&
    !["IGNORE", "UNKNOWN"].includes(label)
  ) {
    label =
      input.section.kind === "policies"
        ? "POLICY"
        : input.section.kind === "contact_info"
          ? "CONTACT_INFO"
          : "REFERENCE";
    failures.push(
      "Non-actionable document section is retained as reference information",
    );
  }
  const hasTime = timeEvidence.test(evidence);
  const hasDateOrDay =
    dateEvidence.test(evidence) || dayEvidence.test(evidence);
  if (input.dueAt && /^\d{4}-\d{2}-\d{2}/.test(input.dueAt)) {
    const date = input.dueAt.slice(0, 10);
    const explicitDates = evidence.match(/\b\d{4}-\d{2}-\d{2}\b/g);
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthDay = evidence.match(
      /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{1,2})\b/i,
    );
    const mismatch = explicitDates
      ? !explicitDates.includes(date)
      : monthDay
        ? Number(date.slice(5, 7)) !==
            monthNames.indexOf(monthDay[1].slice(0, 3).toLowerCase()) + 1 ||
          Number(date.slice(8, 10)) !== Number(monthDay[2])
        : false;
    if (mismatch) {
      failures.push("Extracted date contradicts the quoted source date");
      label = "UNKNOWN";
      confidence = Math.min(confidence, 0.49);
    }
  }
  const event = ["CALENDAR_EVENT", "COURSE_SCHEDULE", "OFFICE_HOURS"].includes(
    label,
  );
  const academicExam =
    input.documentType === "syllabus" &&
    ["exam", "quiz"].includes(input.subtype ?? "") &&
    /\b(?:exam|quiz|midterm|final)\b/i.test(evidence) &&
    dateEvidence.test(evidence) &&
    Boolean(input.dueAt);
  if (
    event &&
    ((!hasTime && !academicExam) ||
      !hasDateOrDay ||
      !meetingEvidence.test(evidence))
  ) {
    failures.push(
      "Calendar conversion requires quoted meeting language and an explicit date/weekday plus time",
    );
    label = "UNKNOWN";
    confidence = Math.min(confidence, 0.69);
  }
  if (
    event &&
    ["research_paper", "dataset", "reference_document", "reading"].includes(
      input.documentType,
    ) &&
    input.section.kind !== "schedule"
  ) {
    failures.push("Historical/reference document dates are not commitments");
    label = "REFERENCE";
    confidence = Math.min(confidence, 0.69);
  }
  if (
    ["ASSIGNMENT", "REQUIRED_FORM"].includes(label) &&
    !input.dueAt &&
    hasTaskInstruction(evidence)
  )
    label = "TASK";
  if (
    ["DEADLINE", "ASSIGNMENT", "REQUIRED_FORM"].includes(label) &&
    (!input.dueAt ||
      Number.isNaN(Date.parse(input.dueAt)) ||
      (!/\b(?:due|deadline|submit|by|before|must|required)\b/i.test(evidence) &&
        !academicExam) ||
      !dateEvidence.test(evidence))
  ) {
    failures.push("Deadline has no grounded due date");
    label = actionEvidence.test(evidence) ? "TASK" : "UNKNOWN";
    confidence = Math.min(confidence, 0.69);
  }
  if (
    ["TASK", "READING", "PROJECT"].includes(label) &&
    !actionEvidence.test(evidence) &&
    !hasTaskInstruction(evidence)
  ) {
    failures.push("No required action or action verb in the evidence");
    label = "REFERENCE";
    confidence = Math.min(confidence, 0.69);
  }
  if (input.evidenceVerified === false) confidence = Math.min(confidence, 0.89);
  if (
    confidence < 0.7 &&
    !["REFERENCE", "POLICY", "CONTACT_INFO", "IGNORE"].includes(label)
  )
    label = "UNKNOWN";
  const normalizedType = [
    "CALENDAR_EVENT",
    "OFFICE_HOURS",
    "COURSE_SCHEDULE",
  ].includes(label)
    ? "calendar_event"
    : ["DEADLINE", "ASSIGNMENT", "REQUIRED_FORM"].includes(label)
      ? "deadline"
      : ["TASK", "READING"].includes(label)
        ? "task"
        : label === "PROJECT"
          ? "project"
          : label === "IGNORE"
            ? "ignore"
            : "reference";
  const required = label !== "OFFICE_HOURS" && hasTaskInstruction(evidence);
  return {
    label,
    confidence,
    normalizedType,
    required,
    evidenceText: quoted ? evidence : "",
    failures,
    actionable: !["reference", "ignore"].includes(normalizedType),
    autoCreate:
      required &&
      confidence >= 0.9 &&
      ["deadline", "task"].includes(normalizedType),
  };
}

export function preserveReviewedExtraction(item: {
  review_status?: string;
  ignore_future_imports?: boolean;
  deleted_at?: string | null;
  manual_corrected_at?: string | null;
  payload?: Record<string, unknown>;
}) {
  return (
    item.review_status !== "pending" ||
    item.payload?.classification_source === "USER" ||
    Boolean(
      item.ignore_future_imports || item.deleted_at || item.manual_corrected_at,
    )
  );
}
