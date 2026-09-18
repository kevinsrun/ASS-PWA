type Props = { data?: Record<string, unknown> };
type Row = {
  title?: unknown;
  schedule?: unknown;
  date?: unknown;
  description?: unknown;
};
export default function DocumentImpact({ data }: Props) {
  if (!data) return null;
  const impact = data.fulfillment as
    | {
        calendar: number;
        deadlines: number;
        tasks: number;
        needsReview: number;
        reference: number;
      }
    | undefined;
  const course = data.course as { name?: string } | undefined;
  return (
    <div className="document-impact">
      {course?.name ? <h3>{course.name}</h3> : null}
      {impact ? (
        <div className="analysis-counts" role="status">
          <span>Added to Calendar: {impact.calendar}</span>
          <span>Created Deadlines: {impact.deadlines}</span>
          <span>Created Tasks: {impact.tasks}</span>
          <span>Needs Review: {impact.needsReview}</span>
          <span>Reference only: {impact.reference}</span>
        </div>
      ) : null}
      {data.documentType === "syllabus" ? (
        <div className="syllabus-overview">
          {[
            ["Schedule", ["meetingTimes", "labs", "discussions"]],
            ["Deadlines", ["exams", "assignments", "projects", "deadlines"]],
            ["Policies", ["attendancePolicy", "gradingPolicy", "latePolicy"]],
          ].map(([heading, keys]) => {
            const rows = (keys as string[]).flatMap((key) =>
              Array.isArray(data[key]) ? (data[key] as Row[]) : [],
            );
            return rows.length ? (
              <details key={String(heading)} open={heading === "Schedule"}>
                <summary>
                  {String(heading)} · {rows.length}
                </summary>
                <ul>
                  {rows.map((row, index) => (
                    <li key={index}>
                      <strong>{String(row.title ?? "")}</strong>
                      <span>
                        {String(row.schedule || row.description || "")}
                        {row.date
                          ? ` · ${new Date(String(row.date)).toLocaleDateString()}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
