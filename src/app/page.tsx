"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { EmailIntelligenceItem } from "@/lib/types";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const rank = { high: 0, medium: 1, low: 2 } as const;

export default function Home() {
  const { todos, plans, profile, toggleTodo, reloadCloud } = useAppContext();
  const { session } = useAuth();
  const [insights, setInsights] = useState<EmailIntelligenceItem[]>([]);
  const today = new Date().toISOString().split("T")[0];
  const nextEvent = plans
    .filter((plan) => plan.date === today)
    .sort((a, b) => a.startLabel.localeCompare(b.startLabel))[0];
  const important = todos
    .filter((todo) => !todo.done && todo.status !== "IGNORED")
    .sort(
      (a, b) =>
        (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
        rank[a.priority] - rank[b.priority],
    )
    .slice(0, 2);
  const focus =
    important[0]?.title ?? nextEvent?.title ?? "Choose what matters most";

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/intelligence/feed", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Feed unavailable")),
      )
      .then((body: { items?: EmailIntelligenceItem[] }) =>
        setInsights(body.items ?? []),
      )
      .catch((error) =>
        console.error("Executive assistant feed failed:", error),
      );
  }, [session?.access_token]);

  async function actOnInsight(id: string, action: "accept" | "dismiss") {
    if (!session?.access_token) return;
    const response = await fetch("/api/intelligence/feed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, action }),
    });
    if (!response.ok) return;
    setInsights((current) => current.filter((item) => item.id !== id));
    if (action === "accept") await reloadCloud();
  }

  return (
    <main className="now-page">
      <header className="now-header">
        <div>
          <p>
            {new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </p>
          <h1>
            {greeting()}, {profile.displayName || "Kevin"}
          </h1>
        </div>
        <Link href="/profile" aria-label="Open profile">
          <UserRound size={21} />
        </Link>
      </header>

      <section className="focus-surface" aria-labelledby="focus-title">
        <span>Right now</span>
        <h2 id="focus-title">{focus}</h2>
        <Link href="/calendar">
          Open today <ArrowRight size={17} />
        </Link>
      </section>

      <section className="now-section">
        <div className="now-section-title">
          <span>Next</span>
          <Link href="/calendar">Calendar</Link>
        </div>
        {nextEvent ? (
          <Link href="/calendar" className="next-event">
            <time>{nextEvent.startLabel}</time>
            <div>
              <strong>{nextEvent.title}</strong>
              <span>{nextEvent.endLabel}</span>
            </div>
            <ArrowRight size={18} />
          </Link>
        ) : (
          <Link href="/calendar" className="quiet-empty">
            <CalendarDays size={19} />
            Your day is open
          </Link>
        )}
      </section>

      <section className="now-section">
        <div className="now-section-title">
          <span>Important</span>
          <Link href="/todos">Projects</Link>
        </div>
        <div className="essential-tasks">
          {important.map((todo) => (
            <button
              key={todo.id}
              type="button"
              onClick={() => toggleTodo(todo.id)}
            >
              <span className="essential-check">
                <Check size={14} />
              </span>
              <strong>{todo.title}</strong>
              {todo.dueDate ? (
                <time className={todo.dueDate < today ? "is-overdue" : ""}>
                  {todo.dueDate === today ? "Today" : todo.dueDate}
                </time>
              ) : null}
            </button>
          ))}
          {important.length === 0 ? (
            <p className="quiet-empty">Nothing needs your attention.</p>
          ) : null}
        </div>
      </section>

      {insights.length > 0 ? (
        <section
          className="now-section assistant-brief"
          aria-label="Executive assistant recommendations"
        >
          <div className="now-section-title">
            <span>Assistant</span>
            <Sparkles size={16} />
          </div>
          <div className="assistant-insights">
            {insights.slice(0, 2).map((item) => (
              <article
                key={item.id}
                className={
                  item.type === "calendar_conflict" ||
                  item.conflictDetails.length
                    ? "has-conflict"
                    : ""
                }
              >
                <div className="assistant-insight-copy">
                  <small>
                    {item.accountEmail} · {item.type.replaceAll("_", " ")}
                  </small>
                  <strong>{item.title}</strong>
                  <p>
                    {item.conflictDetails.length
                      ? `Conflicts with ${item.conflictDetails.join(", ")}.`
                      : item.summary}
                  </p>
                  {item.recommendations[0] ? (
                    <span>{item.recommendations[0]}</span>
                  ) : null}
                </div>
                <div className="assistant-insight-actions">
                  <button
                    type="button"
                    onClick={() => void actOnInsight(item.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void actOnInsight(item.id, "dismiss")}
                  >
                    Dismiss
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
