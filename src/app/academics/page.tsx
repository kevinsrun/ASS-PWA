"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  GraduationCap,
  Megaphone,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  formatAcademicDate,
  getActiveAcademicCourses,
  getCourseByCanvasId,
  getUpcomingAssignments,
} from "@/lib/academic";
import { CourseStatus } from "@/lib/types";
import { useAcademicData } from "@/hooks/useAcademicData";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

const COURSE_STATUSES: Array<{ value: CourseStatus; label: string }> = [
  { value: "registered", label: "Registered" },
  { value: "shopping", label: "Shopping" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "dropped", label: "Dropped" },
  { value: "completed", label: "Completed" },
];

function relativeDueDate(value: string | null) {
  if (!value) return "No due date";
  const hours = (new Date(value).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return "Overdue";
  if (hours < 24) return `Due in ${Math.max(1, Math.round(hours))}h`;
  if (hours < 48) return "Due tomorrow";
  return formatAcademicDate(value);
}

export default function AcademicsPage() {
  const { user } = useAuth();
  const { addTodo } = useAppContext();
  const { snapshot, loading, syncing, error, sync, updateCourseStatus } =
    useAcademicData();
  const activeCourses = getActiveAcademicCourses(snapshot.courses);
  const upcoming = getUpcomingAssignments(snapshot.assignments);
  const unreadAnnouncements = snapshot.resources.filter(
    (resource) => resource.type === "announcement" && !resource.completed
  );
  const modules = snapshot.resources.filter((resource) => resource.type === "module");
  const completedModules = modules.filter((module) => module.completed).length;
  const scores = activeCourses
    .map((course) => course.currentScore)
    .filter((score): score is number => score !== null);
  const averageScore = scores.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
    : null;

  function createStudyTask(assignmentId: string) {
    const assignment = snapshot.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    const course = getCourseByCanvasId(snapshot.courses, assignment.courseCanvasId);
    addTodo(
      `${course?.code ?? "Course"}: ${assignment.title}`,
      assignment.priority,
      assignment.estimatedMinutes,
      assignment.dueAt?.slice(0, 10) ?? null
    );
  }

  return (
    <main className="ass-page-shell">
      <header className="ass-page-header">
        <div>
          <div className="ass-eyebrow">
            <GraduationCap size={15} /> Academic command center
          </div>
          <h1>College, organized around your actual week.</h1>
          <p>
            Courses, deadlines, announcements, and study plans stay connected to
            the same calendar and task system.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={!user || syncing}
          className="ass-primary-button"
        >
          <RefreshCw size={17} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing Canvas" : "Sync Canvas"}
        </button>
      </header>

      {error && (
        <div className="ass-alert" role="status">
          <CircleAlert size={18} />
          <span>{error}</span>
        </div>
      )}

      {!user && (
        <section className="academic-connect-card">
          <div className="academic-connect-icon">
            <GraduationCap size={28} />
          </div>
          <div>
            <h2>Connect your academic account</h2>
            <p>
              Sign in to ASS, then sync Canvas to build your live course and
              assignment plan.
            </p>
          </div>
          <Link href="/login" className="ass-secondary-button">
            Sign in <ChevronRight size={16} />
          </Link>
        </section>
      )}

      <section className="academic-stat-grid" aria-label="Academic overview">
        <article className="academic-stat-card academic-stat-card--violet">
          <div className="academic-stat-icon"><BookOpen size={19} /></div>
          <span>Active courses</span>
          <strong>{activeCourses.length}</strong>
          <small>
            {activeCourses.filter((course) => course.status === "shopping").length} in shopping
          </small>
        </article>
        <article className="academic-stat-card academic-stat-card--orange">
          <div className="academic-stat-icon"><CalendarClock size={19} /></div>
          <span>Upcoming work</span>
          <strong>{upcoming.length}</strong>
          <small>{upcoming.filter((assignment) => assignment.priority === "high").length} high priority</small>
        </article>
        <article className="academic-stat-card academic-stat-card--green">
          <div className="academic-stat-icon"><Check size={19} /></div>
          <span>Module progress</span>
          <strong>{modules.length ? `${Math.round((completedModules / modules.length) * 100)}%` : "—"}</strong>
          <small>{completedModules} of {modules.length} complete</small>
        </article>
        <article className="academic-stat-card academic-stat-card--blue">
          <div className="academic-stat-icon"><Sparkles size={19} /></div>
          <span>Current average</span>
          <strong>{averageScore === null ? "—" : `${averageScore}%`}</strong>
          <small>Across graded courses</small>
        </article>
      </section>

      <div className="academic-layout">
        <div className="academic-main-column">
          <section className="ass-panel">
            <div className="ass-panel-heading">
              <div>
                <span className="ass-kicker">Next up</span>
                <h2>Assignments that need a plan</h2>
              </div>
              <Link href="/calendar" className="ass-text-link">
                Open calendar <ArrowUpRight size={15} />
              </Link>
            </div>

            <div className="assignment-list">
              {upcoming.map((assignment) => {
                const course = getCourseByCanvasId(snapshot.courses, assignment.courseCanvasId);
                return (
                  <article key={assignment.id} className="assignment-row">
                    <div
                      className="assignment-course-mark"
                      style={{ background: course?.color ?? "#5856D6" }}
                      aria-hidden="true"
                    />
                    <div className="assignment-body">
                      <div className="assignment-meta">
                        <span>{course?.code ?? "Course"}</span>
                        <span className={`priority-pill priority-pill--${assignment.priority}`}>
                          {assignment.priority}
                        </span>
                      </div>
                      <h3>{assignment.title}</h3>
                      <div className="assignment-details">
                        <span><Clock3 size={14} /> {assignment.estimatedMinutes} min</span>
                        <span>{relativeDueDate(assignment.dueAt)}</span>
                        <span className="capitalize">{assignment.difficulty} effort</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => createStudyTask(assignment.id)}
                      className="assignment-plan-button"
                    >
                      Plan
                    </button>
                  </article>
                );
              })}
              {!loading && upcoming.length === 0 && (
                <div className="ass-empty-state">
                  <Check size={22} />
                  <div>
                    <strong>No upcoming Canvas assignments</strong>
                    <p>Sync Canvas to refresh coursework and due dates.</p>
                  </div>
                </div>
              )}
              {loading && <div className="ass-loading-bar" aria-label="Loading academic data" />}
            </div>
          </section>

          <section className="ass-panel">
            <div className="ass-panel-heading">
              <div>
                <span className="ass-kicker">Course load</span>
                <h2>Registered and shopping</h2>
              </div>
            </div>
            <div className="course-grid">
              {snapshot.courses.map((course) => (
                <article key={course.id} className="course-card">
                  <div className="course-card-top">
                    <span className="course-color" style={{ background: course.color }} />
                    <select
                      value={course.status}
                      onChange={(event) =>
                        void updateCourseStatus(course.id, event.target.value as CourseStatus)
                      }
                      aria-label={`Status for ${course.name}`}
                    >
                      {COURSE_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>{status.label}</option>
                      ))}
                    </select>
                  </div>
                  <span className="ass-kicker">{course.code}</span>
                  <h3>{course.name}</h3>
                  <p>{course.instructor ?? course.term ?? "Course details from Canvas"}</p>
                  <div className="course-score">
                    <span>{course.currentGrade ?? "In progress"}</span>
                    <strong>{course.currentScore === null ? "—" : `${Math.round(course.currentScore)}%`}</strong>
                  </div>
                </article>
              ))}
              {!loading && snapshot.courses.length === 0 && (
                <div className="ass-empty-state ass-empty-state--wide">
                  <GraduationCap size={22} />
                  <div>
                    <strong>Your course shelf is ready</strong>
                    <p>Canvas courses will appear here with editable registration status.</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="academic-side-column">
          <section className="ass-panel academic-recommendation">
            <div className="recommendation-orb"><Sparkles size={20} /></div>
            <span className="ass-kicker">Planner intelligence</span>
            <h2>{upcoming[0] ? "Start before it becomes urgent" : "Your week has breathing room"}</h2>
            <p>
              {upcoming[0]
                ? `${upcoming[0].title} is estimated at ${upcoming[0].estimatedMinutes} minutes. Add it to your tasks now so the calendar optimizer can protect time for it.`
                : "Once Canvas is synced, ASS will estimate effort and recommend when each assignment should start."}
            </p>
            {upcoming[0] && (
              <button type="button" onClick={() => createStudyTask(upcoming[0].id)}>
                Add recommended task <ChevronRight size={16} />
              </button>
            )}
          </section>

          <section className="ass-panel">
            <div className="ass-panel-heading ass-panel-heading--compact">
              <div>
                <span className="ass-kicker">Inbox</span>
                <h2>Course announcements</h2>
              </div>
              <Megaphone size={18} />
            </div>
            <div className="announcement-list">
              {unreadAnnouncements.slice(0, 4).map((announcement) => {
                const course = announcement.courseCanvasId
                  ? getCourseByCanvasId(snapshot.courses, announcement.courseCanvasId)
                  : null;
                return (
                  <a
                    key={announcement.id}
                    href={announcement.url ?? undefined}
                    target={announcement.url ? "_blank" : undefined}
                    rel={announcement.url ? "noreferrer" : undefined}
                    className="announcement-row"
                  >
                    <span style={{ background: course?.color ?? "#FF7A45" }} />
                    <div>
                      <strong>{announcement.title}</strong>
                      <small>{course?.code ?? "Canvas"}</small>
                    </div>
                    <ChevronRight size={15} />
                  </a>
                );
              })}
              {unreadAnnouncements.length === 0 && (
                <p className="ass-muted-copy">No unread course announcements.</p>
              )}
            </div>
          </section>

          <p className="academic-sync-note">
            {snapshot.syncedAt
              ? `Last synced ${new Date(snapshot.syncedAt).toLocaleString()}`
              : "Canvas has not been synced yet."}
          </p>
        </aside>
      </div>
    </main>
  );
}
