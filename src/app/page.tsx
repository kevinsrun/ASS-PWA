"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Mail,
  Plus,
  Search,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { getUpcomingAssignments } from "@/lib/academic";
import { buildLearningProfile } from "@/lib/learning";
import { useAcademicData } from "@/hooks/useAcademicData";
import { useAppContext } from "@/providers/AppProvider";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { todos, habits, journals, plans, profile, toggleTodo, toggleHabit } =
    useAppContext();
  const { snapshot: academics } = useAcademicData();
  const today = new Date().toISOString().split("T")[0];
  const todaysPlans = plans
    .filter((plan) => plan.date === today)
    .sort((a, b) => a.startLabel.localeCompare(b.startLabel));
  const criticalTasks = todos
    .filter((todo) => !todo.done)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.priority] - rank[b.priority];
    })
    .slice(0, 4);
  const pendingHabits = habits.filter((habit) => habit.lastCompleted !== today);
  const completedTodos = todos.filter((todo) => todo.done).length;
  const completedHabits = habits.length - pendingHabits.length;
  const taskProgress = todos.length ? completedTodos / todos.length : 0;
  const habitProgress = habits.length ? completedHabits / habits.length : 0;
  const dailyProgress = Math.round((taskProgress * 0.65 + habitProgress * 0.35) * 100);
  const longestStreak = habits.length ? Math.max(...habits.map((habit) => habit.streak)) : 0;
  const upcomingAssignments = getUpcomingAssignments(academics.assignments, new Date(), 3);
  const learning = buildLearningProfile({ todos, habits, journals, plans });
  const score = Math.min(
    100,
    Math.round(dailyProgress * 0.65 + Math.min(longestStreak, 14) * 2.5)
  );
  const nextTask = criticalTasks[0];

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <div className="command-date">
            {new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </div>
          <h1>{greeting()}, {profile.displayName || "Kevin"}</h1>
          <p>Your day is clear enough to make meaningful progress.</p>
        </div>
        <div className="command-actions">
          <button type="button" aria-label="Search ASS"><Search size={19} /></button>
          <Link href="/todos" aria-label="Add a task"><Plus size={20} /></Link>
          <Link href="/profile" className="command-avatar" aria-label="Open profile">
            {(profile.displayName || "K").slice(0, 1).toUpperCase()}
          </Link>
        </div>
      </header>

      <section className="morning-brief-card">
        <div className="brief-glow" aria-hidden="true" />
        <div className="brief-copy">
          <div className="ass-eyebrow ass-eyebrow--light">
            <SunMedium size={15} /> Daily briefing
          </div>
          <h2>{nextTask ? `Protect time for ${nextTask.title}` : "A calm start to your day"}</h2>
          <p>
            {nextTask
              ? `${criticalTasks.length} open task${criticalTasks.length === 1 ? "" : "s"}, ${pendingHabits.length} habit${pendingHabits.length === 1 ? "" : "s"}, and ${upcomingAssignments.length} upcoming assignment${upcomingAssignments.length === 1 ? "" : "s"}.`
              : "Add your priorities and ASS will shape them into focused calendar blocks."}
          </p>
          <div className="brief-actions">
            <Link href="/calendar">Plan my day <ArrowRight size={16} /></Link>
            <Link href="/chat">Ask ASS</Link>
          </div>
        </div>
        <div className="brief-score">
          <div
            className="progress-ring"
            style={{ "--progress": `${score * 3.6}deg` } as React.CSSProperties}
          >
            <div><strong>{score}</strong><span>score</span></div>
          </div>
          <small>Productivity score</small>
        </div>
      </section>

      <section className="command-metrics" aria-label="Today at a glance">
        <Link href="/calendar" className="command-metric">
          <span className="metric-icon metric-icon--violet"><CalendarDays size={18} /></span>
          <div><strong>{todaysPlans.length}</strong><span>events today</span></div>
          <ChevronRight size={16} />
        </Link>
        <Link href="/todos" className="command-metric">
          <span className="metric-icon metric-icon--orange"><Check size={18} /></span>
          <div><strong>{criticalTasks.length}</strong><span>critical tasks</span></div>
          <ChevronRight size={16} />
        </Link>
        <Link href="/academics" className="command-metric">
          <span className="metric-icon metric-icon--green"><BookOpen size={18} /></span>
          <div><strong>{upcomingAssignments.length}</strong><span>assignments next</span></div>
          <ChevronRight size={16} />
        </Link>
        <Link href="/calendar" className="command-metric">
          <span className="metric-icon metric-icon--blue"><Mail size={18} /></span>
          <div><strong>AI</strong><span>inbox triage</span></div>
          <ChevronRight size={16} />
        </Link>
      </section>

      <div className="command-grid">
        <section className="ass-panel schedule-panel">
          <div className="ass-panel-heading">
            <div><span className="ass-kicker">Today</span><h2>Your schedule</h2></div>
            <Link href="/calendar" className="ass-text-link">Full calendar <ChevronRight size={15} /></Link>
          </div>
          <div className="schedule-list">
            {todaysPlans.slice(0, 5).map((plan, index) => (
              <article key={plan.id} className="schedule-row">
                <div className="schedule-time"><strong>{plan.startLabel}</strong><span>{plan.endLabel}</span></div>
                <div className="schedule-line" aria-hidden="true">
                  <span className={`schedule-dot schedule-dot--${plan.category ?? "other"}`} />
                  {index < todaysPlans.slice(0, 5).length - 1 && <i />}
                </div>
                <div className="schedule-content"><h3>{plan.title}</h3><p>{plan.category ?? "Personal"}{plan.notes ? ` · ${plan.notes}` : ""}</p></div>
              </article>
            ))}
            {todaysPlans.length === 0 && (
              <div className="ass-empty-state">
                <Clock3 size={22} />
                <div><strong>No blocks yet</strong><p>Give your priorities a place on today’s calendar.</p></div>
                <Link href="/calendar">Build day</Link>
              </div>
            )}
          </div>
        </section>

        <section className="ass-panel tasks-panel">
          <div className="ass-panel-heading">
            <div><span className="ass-kicker">Focus</span><h2>Critical tasks</h2></div>
            <Link href="/todos" className="ass-text-link">All tasks <ChevronRight size={15} /></Link>
          </div>
          <div className="focus-task-list">
            {criticalTasks.map((todo) => (
              <button key={todo.id} type="button" onClick={() => toggleTodo(todo.id)} className="focus-task">
                <span className={`task-check task-check--${todo.priority}`}><Check size={13} /></span>
                <span className="focus-task-copy"><strong>{todo.title}</strong><small>{todo.duration} min{todo.dueDate ? ` · due ${todo.dueDate}` : ""}</small></span>
                <span className={`priority-pill priority-pill--${todo.priority}`}>{todo.priority}</span>
              </button>
            ))}
            {criticalTasks.length === 0 && (
              <div className="ass-empty-state"><Check size={22} /><div><strong>Nothing urgent</strong><p>Your highest-priority tasks will stay visible here.</p></div></div>
            )}
          </div>
        </section>

        <section className="ass-panel academic-preview-panel">
          <div className="ass-panel-heading">
            <div><span className="ass-kicker">Brown</span><h2>Academic outlook</h2></div>
            <Link href="/academics" className="ass-text-link">Command center <ChevronRight size={15} /></Link>
          </div>
          {upcomingAssignments.length > 0 ? (
            <div className="academic-preview-list">
              {upcomingAssignments.map((assignment) => (
                <article key={assignment.id}>
                  <span className={`priority-dot priority-dot--${assignment.priority}`} />
                  <div><strong>{assignment.title}</strong><small>{assignment.dueAt ? new Date(assignment.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No due date"} · {assignment.estimatedMinutes} min</small></div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ass-empty-state"><BookOpen size={22} /><div><strong>Canvas is ready to connect</strong><p>Bring classes and assignments into the same weekly plan.</p></div></div>
          )}
        </section>

        <section className="ass-panel habits-panel">
          <div className="ass-panel-heading">
            <div><span className="ass-kicker">Momentum</span><h2>Habits & energy</h2></div>
            <span className="streak-pill"><Flame size={14} /> {longestStreak} day streak</span>
          </div>
          <div className="habit-quick-list">
            {habits.slice(0, 3).map((habit) => {
              const done = habit.lastCompleted === today;
              return (
                <button key={habit.id} type="button" onClick={() => toggleHabit(habit.id)} disabled={done}>
                  <span className={done ? "is-done" : ""}>{done ? <Check size={15} /> : habit.category === "fitness" ? <Dumbbell size={15} /> : <Sparkles size={15} />}</span>
                  <strong>{habit.name}</strong>
                  <small>{done ? "Done" : "Check in"}</small>
                </button>
              );
            })}
            {habits.length === 0 && (
              <div className="ass-empty-state"><Flame size={22} /><div><strong>Build your rhythm</strong><p>Add habits to track consistency without crowding your day.</p></div></div>
            )}
          </div>
          <div className="learning-note"><Sparkles size={17} /><p><strong>ASS is adapting.</strong> Your plan currently favors {learning.preferredTimeOfDay} focus and a {learning.workload} workload.</p></div>
        </section>
      </div>
    </main>
  );
}
