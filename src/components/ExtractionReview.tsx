"use client";
import { ChevronDown } from "lucide-react";
type Item = {
  id: string;
  item_type: string;
  title: string;
  description: string;
  due_at: string | null;
  confidence: number;
  normalized_type: string | null;
  review_status: string;
  payload?: Record<string, unknown>;
};
type Props = {
  items: Item[];
  busy: string | null;
  conversionTypes: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onReview: (
    id: string,
    action: "approve" | "reject",
    normalizedType?: string,
  ) => void;
};
function section(item: Item) {
  if (["committed", "rejected"].includes(item.review_status)) return "Reviewed";
  if (
    Number(item.payload?.analysisVersion) < 2 ||
    item.payload?.bucket === "UNCERTAIN" ||
    item.item_type === "unknown" ||
    (item.confidence < 0.9 &&
      ["calendar_event", "deadline", "task", "project"].includes(
        item.normalized_type ?? "",
      ))
  )
    return "Needs Review";
  return ["calendar_event", "deadline", "task", "project"].includes(
    item.normalized_type ?? "",
  )
    ? "Actionable"
    : "Reference";
}
const labels: Record<string, string> = {
  calendar_event: "Calendar Events",
  deadline: "Deadlines",
  task: "Tasks",
  project: "Projects",
  reference: "Reference",
  policy: "Policies",
  material: "Resources",
  contact_info: "Course Details",
  course: "Course Details",
  office_hours: "Office Hours",
};
const actionLabel: Record<string, string> = {
  calendar_event: "Add to Calendar",
  deadline: "Create Task + Deadline",
  task: "Create Task",
  project: "Create Project Task",
  reference: "Keep Reference",
};
export default function ExtractionReview({
  items,
  busy,
  conversionTypes,
  onChange,
  onReview,
}: Props) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = section(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return (
    <div className="extraction-groups">
      {["Actionable", "Needs Review", "Reference", "Reviewed"]
        .filter((key) => groups.has(key))
        .map((key) => {
          const entries = groups.get(key)!;
          const counts = new Map<string, number>();
          for (const item of entries) {
            const label =
              labels[item.item_type] ??
              labels[item.normalized_type ?? "reference"] ??
              "Items";
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }
          return (
            <details
              className="extraction-group"
              key={key}
              open={["Actionable", "Needs Review"].includes(key)}
            >
              <summary>
                <strong>{key}</strong>
                <span className="extraction-group-meta">
                  <span className="extraction-group-count">
                    {entries.length}
                  </span>
                  <ChevronDown size={18} aria-hidden="true" />
                </span>
              </summary>
              <div className="analysis-counts">
                {[...counts].map(([label, count]) => (
                  <span key={label}>
                    {count} {label}
                  </span>
                ))}
              </div>
              <div className="extraction-list">
                {entries.map((item) => {
                  const pending = ["pending", "approved"].includes(
                      item.review_status,
                    ),
                    verified = Number(item.payload?.analysisVersion) >= 2;
                  const selected =
                    conversionTypes[item.id] ??
                    (verified
                      ? (item.normalized_type ?? "reference")
                      : "reference");
                  return (
                    <article className="extraction-item" key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        {item.due_at && verified ? (
                          <time>
                            {new Date(item.due_at).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        ) : item.payload?.schedule &&
                          selected === "calendar_event" ? (
                          <p className="extraction-schedule">
                            {String(item.payload.schedule)}
                          </p>
                        ) : item.description ? (
                          <p className="extraction-description">
                            {item.description}
                          </p>
                        ) : null}
                        <small>
                          {pending
                            ? verified
                              ? `${Math.round(item.confidence * 100)}% confidence · ${String(item.payload?.sourceSection ?? "Source")}`
                              : "Old analysis · re-analyze before converting"
                            : item.review_status === "committed"
                              ? "Converted · decision preserved"
                              : "Ignored · decision preserved"}
                        </small>
                        {item.payload?.evidence_text ? (
                          <details>
                            <summary>Evidence and reasoning</summary>
                            <blockquote>
                              {String(item.payload.evidence_text)}
                            </blockquote>
                            <small>
                              {String(item.payload.source_location ?? "")}
                            </small>
                            <p>
                              {String(item.payload.reasoning_summary ?? "")}
                            </p>
                          </details>
                        ) : null}
                      </div>
                      {pending ? (
                        <div className="extraction-convert">
                          <button
                            className="convert-button"
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              onReview(item.id, "approve", selected)
                            }
                          >
                            {busy === item.id
                              ? "Saving…"
                              : (actionLabel[selected] ?? "Keep Reference")}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => onReview(item.id, "reject")}
                          >
                            Ignore
                          </button>
                          <details className="extraction-correction">
                            <summary>Change type</summary>
                            <select
                              aria-label={`Review ${item.title} as`}
                              value={selected}
                              onChange={(event) =>
                                onChange(item.id, event.target.value)
                              }
                            >
                              <option value="reference">Reference</option>
                              <option value="calendar_event">
                                Calendar event
                              </option>
                              <option value="deadline">Deadline + task</option>
                              <option value="task">Task</option>
                              <option value="project">Project task</option>
                            </select>
                          </details>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </details>
          );
        })}
    </div>
  );
}
