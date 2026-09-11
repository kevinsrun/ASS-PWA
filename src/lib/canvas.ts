import "server-only";

import { AcademicAssignment, AcademicResourceType, PlanPriority } from "@/lib/types";

const COURSE_COLORS = [
  "#5856D6",
  "#0A84FF",
  "#30B47A",
  "#FF7A45",
  "#AF52DE",
  "#D9467A",
];

type CanvasEnrollment = {
  type?: string;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
};

type CanvasCourse = {
  id: number;
  name: string;
  course_code?: string;
  start_at?: string | null;
  end_at?: string | null;
  syllabus_body?: string | null;
  term?: { name?: string };
  teachers?: Array<{ display_name?: string; name?: string }>;
  enrollments?: CanvasEnrollment[];
};

type CanvasSubmission = {
  workflow_state?: string;
  submitted_at?: string | null;
  score?: number | null;
  grade?: string | null;
  preview_url?: string | null;
};

type CanvasAssignment = {
  id: number;
  name: string;
  description?: string | null;
  due_at?: string | null;
  unlock_at?: string | null;
  points_possible?: number | null;
  html_url?: string | null;
  submission?: CanvasSubmission | null;
};

type CanvasModuleItem = {
  id: number;
  title?: string;
  type?: string;
  html_url?: string | null;
  completion_requirement?: { completed?: boolean; type?: string } | null;
};

type CanvasModule = {
  id: number;
  name: string;
  position?: number;
  state?: string;
  items?: CanvasModuleItem[];
};

type CanvasPage = {
  page_id?: number;
  url: string;
  title: string;
  html_url?: string | null;
  updated_at?: string | null;
};

type CanvasFile = {
  id: number;
  display_name?: string;
  filename?: string;
  url?: string | null;
  updated_at?: string | null;
  content_type?: string | null;
  size?: number;
};

type CanvasDiscussion = {
  id: number;
  title: string;
  html_url?: string | null;
  posted_at?: string | null;
  last_reply_at?: string | null;
  unread_count?: number;
};

type CanvasAnnouncement = {
  id: number;
  title: string;
  html_url?: string | null;
  posted_at?: string | null;
  context_code?: string;
  unread_count?: number;
};

type CanvasCalendarEvent = {
  id: number;
  title: string;
  html_url?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  context_code?: string;
};

export type CanvasCourseRecord = {
  canvas_id: number;
  name: string;
  course_code: string;
  color: string;
  term_name: string | null;
  instructor_name: string | null;
  syllabus_html: string | null;
  current_score: number | null;
  current_grade: string | null;
  start_at: string | null;
  end_at: string | null;
  raw_data: Record<string, unknown>;
};

export type CanvasAssignmentRecord = {
  canvas_id: number;
  course_canvas_id: number;
  title: string;
  description_html: string | null;
  due_at: string | null;
  unlock_at: string | null;
  points_possible: number | null;
  score: number | null;
  grade: string | null;
  submitted: boolean;
  submission_status: string;
  submission_url: string | null;
  estimated_minutes: number;
  difficulty: AcademicAssignment["difficulty"];
  priority: PlanPriority;
  recommended_start_at: string | null;
  recommended_complete_at: string | null;
  raw_data: Record<string, unknown>;
};

export type CanvasResourceRecord = {
  course_canvas_id: number | null;
  external_id: string;
  resource_type: AcademicResourceType;
  title: string;
  url: string | null;
  published_at: string | null;
  due_at: string | null;
  completed: boolean;
  metadata: Record<string, unknown>;
};

export type CanvasSyncPayload = {
  courses: CanvasCourseRecord[];
  assignments: CanvasAssignmentRecord[];
  resources: CanvasResourceRecord[];
};

function getCanvasConfig() {
  const baseUrl = process.env.CANVAS_BASE_URL;
  const token = process.env.CANVAS_ACCESS_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN.");
  }

  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("CANVAS_BASE_URL must use HTTPS.");
  }

  return { baseUrl: url.origin, token };
}

function getNextLink(header: string | null) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function fetchCanvasPage<T>(
  url: string,
  token: string,
  attempt = 0
): Promise<{ data: T[]; next: string | null }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 3) * 1_000));
    return fetchCanvasPage<T>(url, token, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Canvas request failed (${response.status}) for ${new URL(url).pathname}`);
  }

  return {
    data: (await response.json()) as T[],
    next: getNextLink(response.headers.get("link")),
  };
}

async function fetchCanvasCollection<T>(
  pathname: string,
  params: Array<[string, string]> = []
) {
  const { baseUrl, token } = getCanvasConfig();
  const firstUrl = new URL(`${baseUrl}${pathname}`);
  params.forEach(([key, value]) => firstUrl.searchParams.append(key, value));
  firstUrl.searchParams.set("per_page", "100");

  const records: T[] = [];
  let next: string | null = firstUrl.toString();
  let pageCount = 0;

  while (next && pageCount < 25) {
    const batch: { data: T[]; next: string | null } = await fetchCanvasPage<T>(
      next,
      token
    );
    records.push(...batch.data);
    next = batch.next;
    pageCount += 1;
  }

  return records;
}

function stripHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function assignmentIntelligence(assignment: CanvasAssignment) {
  const text = `${assignment.name} ${stripHtml(assignment.description)}`;
  const points = assignment.points_possible ?? 0;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const highSignals = /exam|midterm|final|project|paper|presentation|lab report/i.test(text);
  const mediumSignals = /problem set|homework|quiz|reading response|essay/i.test(text);
  const estimatedMinutes = Math.min(
    480,
    Math.max(30, Math.round((45 + points * 2 + wordCount * 0.35) / 15) * 15)
  );
  const difficulty: AcademicAssignment["difficulty"] =
    highSignals || estimatedMinutes >= 180 ? "high" : mediumSignals || estimatedMinutes >= 90 ? "medium" : "low";

  const dueAt = assignment.due_at ? new Date(assignment.due_at) : null;
  const daysUntilDue = dueAt
    ? (dueAt.getTime() - Date.now()) / 86_400_000
    : Number.POSITIVE_INFINITY;
  const priority: PlanPriority =
    daysUntilDue <= 2 || difficulty === "high"
      ? "high"
      : daysUntilDue <= 7 || difficulty === "medium"
      ? "medium"
      : "low";

  const recommendedCompleteAt = dueAt
    ? new Date(dueAt.getTime() - Math.min(12 * 60, Math.max(60, estimatedMinutes / 2)) * 60_000)
    : null;
  const leadDays = difficulty === "high" ? 5 : difficulty === "medium" ? 3 : 1;
  const recommendedStartAt = dueAt
    ? new Date(dueAt.getTime() - leadDays * 86_400_000)
    : null;

  return {
    estimatedMinutes,
    difficulty,
    priority,
    recommendedStartAt: recommendedStartAt?.toISOString() ?? null,
    recommendedCompleteAt: recommendedCompleteAt?.toISOString() ?? null,
  };
}

function safeCourseRaw(course: CanvasCourse): Record<string, unknown> {
  return {
    id: course.id,
    name: course.name,
    courseCode: course.course_code ?? null,
    term: course.term?.name ?? null,
  };
}

async function fetchCourseDetail(course: CanvasCourse) {
  const courseId = encodeURIComponent(String(course.id));
  const [assignments, modules, pages, files, discussions, calendarEvents] =
    await Promise.all([
      fetchCanvasCollection<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`, [
        ["include[]", "submission"],
        ["order_by", "due_at"],
      ]),
      fetchCanvasCollection<CanvasModule>(`/api/v1/courses/${courseId}/modules`, [
        ["include[]", "items"],
        ["include[]", "content_details"],
      ]),
      fetchCanvasCollection<CanvasPage>(`/api/v1/courses/${courseId}/pages`),
      fetchCanvasCollection<CanvasFile>(`/api/v1/courses/${courseId}/files`),
      fetchCanvasCollection<CanvasDiscussion>(`/api/v1/courses/${courseId}/discussion_topics`),
      fetchCanvasCollection<CanvasCalendarEvent>("/api/v1/calendar_events", [
        ["context_codes[]", `course_${course.id}`],
        ["type", "event"],
      ]),
    ]);

  const assignmentRecords: CanvasAssignmentRecord[] = assignments.map((assignment) => {
    const intelligence = assignmentIntelligence(assignment);
    const submission = assignment.submission;
    return {
      canvas_id: assignment.id,
      course_canvas_id: course.id,
      title: assignment.name,
      description_html: assignment.description ?? null,
      due_at: assignment.due_at ?? null,
      unlock_at: assignment.unlock_at ?? null,
      points_possible: assignment.points_possible ?? null,
      score: submission?.score ?? null,
      grade: submission?.grade ?? null,
      submitted: Boolean(submission?.submitted_at),
      submission_status: submission?.workflow_state ?? "unsubmitted",
      submission_url: submission?.preview_url ?? assignment.html_url ?? null,
      estimated_minutes: intelligence.estimatedMinutes,
      difficulty: intelligence.difficulty,
      priority: intelligence.priority,
      recommended_start_at: intelligence.recommendedStartAt,
      recommended_complete_at: intelligence.recommendedCompleteAt,
      raw_data: {
        htmlUrl: assignment.html_url ?? null,
      },
    };
  });

  const resources: CanvasResourceRecord[] = [
    ...modules.map((module) => ({
      course_canvas_id: course.id,
      external_id: String(module.id),
      resource_type: "module" as const,
      title: module.name,
      url: null,
      published_at: null,
      due_at: null,
      completed: Boolean(
        module.items?.length &&
          module.items.every((item) => item.completion_requirement?.completed !== false)
      ),
      metadata: {
        position: module.position ?? null,
        state: module.state ?? null,
        itemCount: module.items?.length ?? 0,
        completedItems:
          module.items?.filter((item) => item.completion_requirement?.completed).length ?? 0,
      },
    })),
    ...pages.map((page) => ({
      course_canvas_id: course.id,
      external_id: String(page.page_id ?? page.url),
      resource_type: "page" as const,
      title: page.title,
      url: page.html_url ?? null,
      published_at: page.updated_at ?? null,
      due_at: null,
      completed: false,
      metadata: { pageUrl: page.url },
    })),
    ...files.map((file) => ({
      course_canvas_id: course.id,
      external_id: String(file.id),
      resource_type: "file" as const,
      title: file.display_name ?? file.filename ?? "Course file",
      url: file.url ?? null,
      published_at: file.updated_at ?? null,
      due_at: null,
      completed: false,
      metadata: { contentType: file.content_type ?? null, size: file.size ?? null },
    })),
    ...discussions.map((discussion) => ({
      course_canvas_id: course.id,
      external_id: String(discussion.id),
      resource_type: "discussion" as const,
      title: discussion.title,
      url: discussion.html_url ?? null,
      published_at: discussion.posted_at ?? null,
      due_at: null,
      completed: (discussion.unread_count ?? 0) === 0,
      metadata: {
        unreadCount: discussion.unread_count ?? 0,
        lastReplyAt: discussion.last_reply_at ?? null,
      },
    })),
    ...calendarEvents.map((event) => ({
      course_canvas_id: course.id,
      external_id: String(event.id),
      resource_type: "calendar_event" as const,
      title: event.title,
      url: event.html_url ?? null,
      published_at: event.start_at ?? null,
      due_at: event.end_at ?? event.start_at ?? null,
      completed: false,
      metadata: { contextCode: event.context_code ?? null },
    })),
  ];

  return { assignmentRecords, resources };
}

export async function fetchCanvasSnapshot(): Promise<CanvasSyncPayload> {
  const courses = await fetchCanvasCollection<CanvasCourse>("/api/v1/courses", [
    ["enrollment_state", "active"],
    ["include[]", "term"],
    ["include[]", "teachers"],
    ["include[]", "syllabus_body"],
    ["include[]", "total_scores"],
  ]);

  const details = await Promise.all(courses.map(fetchCourseDetail));
  const announcements = courses.length
    ? await fetchCanvasCollection<CanvasAnnouncement>(
        "/api/v1/announcements",
        courses.map((course) => ["context_codes[]", `course_${course.id}`])
      )
    : [];

  const courseRecords: CanvasCourseRecord[] = courses.map((course, index) => {
    const studentEnrollment = course.enrollments?.find((enrollment) =>
      enrollment.type?.toLowerCase().includes("student")
    );
    return {
      canvas_id: course.id,
      name: course.name,
      course_code: course.course_code ?? "Course",
      color: COURSE_COLORS[index % COURSE_COLORS.length],
      term_name: course.term?.name ?? null,
      instructor_name:
        course.teachers?.[0]?.display_name ?? course.teachers?.[0]?.name ?? null,
      syllabus_html: course.syllabus_body ?? null,
      current_score: studentEnrollment?.computed_current_score ?? null,
      current_grade: studentEnrollment?.computed_current_grade ?? null,
      start_at: course.start_at ?? null,
      end_at: course.end_at ?? null,
      raw_data: safeCourseRaw(course),
    };
  });

  const announcementResources: CanvasResourceRecord[] = announcements.map((announcement) => {
    const courseCanvasId = Number(announcement.context_code?.replace("course_", ""));
    return {
      course_canvas_id: Number.isFinite(courseCanvasId) ? courseCanvasId : null,
      external_id: String(announcement.id),
      resource_type: "announcement",
      title: announcement.title,
      url: announcement.html_url ?? null,
      published_at: announcement.posted_at ?? null,
      due_at: null,
      completed: (announcement.unread_count ?? 0) === 0,
      metadata: { unreadCount: announcement.unread_count ?? 0 },
    };
  });

  return {
    courses: courseRecords,
    assignments: details.flatMap((detail) => detail.assignmentRecords),
    resources: [...details.flatMap((detail) => detail.resources), ...announcementResources],
  };
}
