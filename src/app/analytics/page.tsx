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
    <main className="simple-page">
      <header className="simple-header">
        <span>Insights</span>
        <h1>Analytics</h1>
        <p>A quiet view of your recent patterns.</p>
      </header>

      <section className="metrics-list">
        <Stat label="Open todos" value={openTodos} />
        <Stat label="Completed todos" value={completedTodos} />
        <Stat label="Journal entries" value={journals.length} />
        <Stat label="Chat turns" value={chatMessages.length} />
        <Stat label="Calendar plans" value={plans.length} />
        <Stat label="Habits done today" value={`${completedHabits}/${habits.length}`} />
        <Stat label="Coding workflows" value={codingWorkflows.length} />
        <Stat label="Best time" value={learning.preferredTimeOfDay} />
      </section>

      <section className="simple-group strategy-group">
        <h2>Adaptive strategy</h2>
        <div>
          {learning.strategies.map((strategy) => (
            <article key={strategy.id}>
              <strong>{strategy.title}</strong>
              <p>{strategy.action}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
