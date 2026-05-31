"use client";

import { buildLearningProfile } from "@/lib/learning";
import { useAppContext } from "@/providers/AppProvider";

export default function AnalyticsPage() {
  const { todos, habits, journals, plans, chatMessages, codingWorkflows } =
    useAppContext();
  const learning = buildLearningProfile({ todos, habits, journals, plans });
  const completedTodos = todos.filter((todo) => todo.done).length;
  const openTodos = todos.length - completedTodos;
  const completedHabits = habits.filter(
    (habit) => habit.lastCompleted === new Date().toISOString().split("T")[0]
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-bold text-emerald-950">Analytics</h1>
      <p className="mt-2 text-slate-600">
        Separate space for patterns, progress, and adaptation signals.
      </p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open todos" value={openTodos} />
        <Stat label="Completed todos" value={completedTodos} />
        <Stat label="Journal entries" value={journals.length} />
        <Stat label="Chat turns" value={chatMessages.length} />
        <Stat label="Calendar plans" value={plans.length} />
        <Stat label="Habits done today" value={`${completedHabits}/${habits.length}`} />
        <Stat label="Coding workflows" value={codingWorkflows.length} />
        <Stat label="Best time" value={learning.preferredTimeOfDay} />
      </section>

      <section className="ios-card mt-6 rounded-3xl p-5">
        <h2 className="text-xl font-semibold text-emerald-950">Adaptive Strategy</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {learning.strategies.map((strategy) => (
            <article key={strategy.id} className="rounded-2xl bg-white/80 p-4">
              <div className="font-semibold">{strategy.title}</div>
              <p className="mt-1 text-sm text-slate-600">{strategy.action}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="ios-card rounded-3xl p-4">
      <div className="text-2xl font-semibold text-emerald-700">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
