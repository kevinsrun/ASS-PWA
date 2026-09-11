import {
  AcademicAssignment,
  AcademicCourse,
  AcademicResource,
  AcademicSnapshot,
  CourseStatus,
} from "@/lib/types";

export type AcademicCourseRow = {
  id: string;
  canvas_id: number | string;
  name: string;
  course_code: string | null;
  status: CourseStatus | null;
  color: string | null;
  term_name: string | null;
  instructor_name: string | null;
  syllabus_html: string | null;
  current_score: number | string | null;
  current_grade: string | null;
  start_at: string | null;
  end_at: string | null;
};

export type AcademicAssignmentRow = {
  id: string;
  canvas_id: number | string;
  course_id: string;
  course_canvas_id: number | string;
  title: string;
  description_html: string | null;
  due_at: string | null;
  unlock_at: string | null;
  points_possible: number | string | null;
  score: number | string | null;
  grade: string | null;
  submitted: boolean | null;
  submission_status: string | null;
  submission_url: string | null;
  estimated_minutes: number | string | null;
  difficulty: AcademicAssignment["difficulty"] | null;
  priority: AcademicAssignment["priority"] | null;
  recommended_start_at: string | null;
  recommended_complete_at: string | null;
};

export type AcademicResourceRow = {
  id: string;
  course_id: string | null;
  course_canvas_id: number | string | null;
  external_id: string;
  resource_type: AcademicResource["type"];
  title: string;
  url: string | null;
  published_at: string | null;
  due_at: string | null;
  completed: boolean | null;
  metadata: Record<string, unknown> | null;
};

function numberOrNull(value: number | string | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function academicSnapshotFromRows(
  courses: AcademicCourseRow[],
  assignments: AcademicAssignmentRow[],
  resources: AcademicResourceRow[],
  syncedAt: string | null = null
): AcademicSnapshot {
  return {
    syncedAt,
    courses: courses.map((course) => ({
      id: course.id,
      canvasId: Number(course.canvas_id),
      name: course.name,
      code: course.course_code ?? "Course",
      status: course.status ?? "registered",
      color: course.color ?? "#5856D6",
      term: course.term_name,
      instructor: course.instructor_name,
      syllabusHtml: course.syllabus_html,
      currentScore: numberOrNull(course.current_score),
      currentGrade: course.current_grade,
      startAt: course.start_at,
      endAt: course.end_at,
    })),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      canvasId: Number(assignment.canvas_id),
      courseId: assignment.course_id,
      courseCanvasId: Number(assignment.course_canvas_id),
      title: assignment.title,
      descriptionHtml: assignment.description_html,
      dueAt: assignment.due_at,
      unlockAt: assignment.unlock_at,
      pointsPossible: numberOrNull(assignment.points_possible),
      score: numberOrNull(assignment.score),
      grade: assignment.grade,
      submitted: Boolean(assignment.submitted),
      submissionStatus: assignment.submission_status ?? "unsubmitted",
      submissionUrl: assignment.submission_url,
      estimatedMinutes: Number(assignment.estimated_minutes ?? 60),
      difficulty: assignment.difficulty ?? "medium",
      priority: assignment.priority ?? "medium",
      recommendedStartAt: assignment.recommended_start_at,
      recommendedCompleteAt: assignment.recommended_complete_at,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      courseId: resource.course_id,
      courseCanvasId:
        resource.course_canvas_id === null ? null : Number(resource.course_canvas_id),
      externalId: resource.external_id,
      type: resource.resource_type,
      title: resource.title,
      url: resource.url,
      publishedAt: resource.published_at,
      dueAt: resource.due_at,
      completed: Boolean(resource.completed),
      metadata: resource.metadata ?? {},
    })),
  };
}

export function emptyAcademicSnapshot(): AcademicSnapshot {
  return { courses: [], assignments: [], resources: [], syncedAt: null };
}

export function getActiveAcademicCourses(courses: AcademicCourse[]) {
  return courses.filter((course) =>
    ["registered", "shopping", "waitlisted"].includes(course.status)
  );
}

export function getUpcomingAssignments(
  assignments: AcademicAssignment[],
  now = new Date(),
  limit = 8
) {
  return assignments
    .filter(
      (assignment) =>
        !assignment.submitted &&
        assignment.dueAt &&
        new Date(assignment.dueAt).getTime() >= now.getTime()
    )
    .sort(
      (a, b) =>
        new Date(a.dueAt as string).getTime() -
        new Date(b.dueAt as string).getTime()
    )
    .slice(0, limit);
}

export function getCourseByCanvasId(courses: AcademicCourse[], canvasId: number) {
  return courses.find((course) => course.canvasId === canvasId) ?? null;
}

export function formatAcademicDate(value: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
