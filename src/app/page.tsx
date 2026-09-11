"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Plus } from "lucide-react";
import { useAppContext } from "@/providers/AppProvider";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const rank = { high: 0, medium: 1, low: 2 } as const;

export default function Home() {
  const { todos, plans, profile, toggleTodo } = useAppContext();
  const today = new Date().toISOString().split("T")[0];
  const nextEvent = plans.filter((plan) => plan.date === today).sort((a, b) => a.startLabel.localeCompare(b.startLabel))[0];
  const important = todos.filter((todo) => !todo.done).sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 2);
  const focus = important[0]?.title ?? nextEvent?.title ?? "Choose what matters most";

  return (
    <main className="now-page">
      <header className="now-header">
        <div>
          <p>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</p>
          <h1>{greeting()}, {profile.displayName || "Kevin"}</h1>
        </div>
        <Link href="/todos" aria-label="Add a task"><Plus size={21} /></Link>
      </header>

      <section className="focus-surface" aria-labelledby="focus-title">
        <span>Right now</span>
        <h2 id="focus-title">{focus}</h2>
        <Link href="/calendar">Open today <ArrowRight size={17} /></Link>
      </section>

      <section className="now-section">
        <div className="now-section-title"><span>Next</span><Link href="/calendar">Calendar</Link></div>
        {nextEvent ? (
          <Link href="/calendar" className="next-event">
            <time>{nextEvent.startLabel}</time>
            <div><strong>{nextEvent.title}</strong><span>{nextEvent.endLabel}</span></div>
            <ArrowRight size={18} />
          </Link>
        ) : <Link href="/calendar" className="quiet-empty"><CalendarDays size={19} />Your day is open</Link>}
      </section>

      <section className="now-section">
        <div className="now-section-title"><span>Important</span><Link href="/todos">Projects</Link></div>
        <div className="essential-tasks">
          {important.map((todo) => (
            <button key={todo.id} type="button" onClick={() => toggleTodo(todo.id)}>
              <span className="essential-check"><Check size={14} /></span><strong>{todo.title}</strong>
              {todo.dueDate ? <time className={todo.dueDate < today ? "is-overdue" : ""}>{todo.dueDate === today ? "Today" : todo.dueDate}</time> : null}
            </button>
          ))}
          {important.length === 0 ? <p className="quiet-empty">Nothing needs your attention.</p> : null}
        </div>
      </section>
    </main>
  );
}
