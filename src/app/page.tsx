"use client";

import Link from "next/link";
import { useAppContext } from "@/providers/AppProvider";
import { buildLearningProfile } from "@/lib/learning";

export default function Home() {
  const { todos, habits, journals, plans } = useAppContext();

  const today = new Date().toISOString().split("T")[0];

  const completedTodos = todos.filter((todo) => todo.done).length;
  const todoProgress = todos.length
    ? Math.round((completedTodos / todos.length) * 100)
    : 0;
  const completedHabits = habits.filter(
    (habit) => habit.lastCompleted === today
  ).length;
  const habitProgress = habits.length
    ? Math.round((completedHabits / habits.length) * 100)
    : 0;
  const longestStreak =
    habits.length > 0 ? Math.max(...habits.map((habit) => habit.streak)) : 0;
  const overdueTodos = todos.filter(
    (todo) => todo.dueDate && todo.dueDate < today && !todo.done
  );
  const upcomingPlans = plans
    .filter((plan) => plan.date >= today)
    .sort((a, b) => `${a.date} ${a.startLabel}`.localeCompare(`${b.date} ${b.startLabel}`))
    .slice(0, 4);
  const learning = buildLearningProfile({
    todos,
    habits,
    journals,
    plans,
  });

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold text-emerald-950">ASS Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Task manager, habit tracker, calendar planner, and AI assistant.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/todos"
            className="rounded-xl border border-blue-100 bg-white/90 p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">To-Dos</h2>
            <p className="mt-2 text-gray-600">
              {completedTodos}/{todos.length} completed
            </p>
          </Link>

          <Link
            href="/habits"
            className="rounded-xl border border-emerald-100 bg-white/90 p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Habits</h2>
            <p className="mt-2 text-gray-600">
              {completedHabits}/{habits.length} completed today
            </p>
          </Link>

          <Link
            href="/calendar"
            className="rounded-xl border border-cyan-100 bg-white/90 p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Calendar</h2>
            <p className="mt-2 text-gray-600">
              Longest current streak: {longestStreak}
            </p>
          </Link>

          <Link
            href="/chat"
            className="rounded-xl border border-indigo-100 bg-white/90 p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">AI Chat</h2>
            <p className="mt-2 text-gray-600">
              Plan your day with your live data
            </p>
          </Link>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Adaptive Learning</h2>
                <p className="mt-1 text-sm text-gray-600">
                  The app is adapting toward {learning.guiDensity} density,{" "}
                  {learning.preferredTimeOfDay} scheduling, and{" "}
                  {learning.preferredCategory} as your strongest category.
                </p>
              </div>
              <div className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
                {learning.workload} workload
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {learning.strategies.slice(0, 2).map((strategy) => (
                <div key={strategy.id} className="rounded-lg bg-slate-50 p-4">
                  <div className="font-medium">{strategy.title}</div>
                  <p className="mt-1 text-sm text-gray-600">{strategy.body}</p>
                  <div className="mt-2 text-sm font-medium text-indigo-700">
                    {strategy.action}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-blue-100 bg-white/90 p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Today Progress</h2>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Tasks</span>
                  <span>{todoProgress}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${todoProgress}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Habits</span>
                  <span>{habitProgress}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${habitProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-cyan-100 bg-white/90 p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Upcoming Schedule</h2>
            <div className="mt-4 space-y-3">
              {upcomingPlans.map((plan) => (
                <div key={plan.id} className="rounded-lg bg-slate-50 p-3">
                  <div className="font-medium">{plan.title}</div>
                  <div className="text-sm text-gray-500">
                    {plan.date} · {plan.startLabel}
                  </div>
                </div>
              ))}
              {upcomingPlans.length === 0 && (
                <div className="text-sm text-gray-500">Nothing scheduled.</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <h2 className="text-lg font-semibold">Overdue Warning</h2>
            <p className="mt-2 text-sm">
              {overdueTodos.length
                ? `${overdueTodos.length} overdue task(s) need attention.`
                : "No overdue tasks right now."}
            </p>
          </section>

          <section className="rounded-xl border border-indigo-100 bg-white/90 p-5 shadow-sm">
            <h2 className="text-lg font-semibold">AI Recommendation</h2>
            <p className="mt-2 text-sm text-gray-600">
              {overdueTodos.length
                ? "Clear one overdue task before adding new plans."
                : completedHabits < habits.length
                ? "Finish a pending habit before the next focus block."
                : "Use the calendar optimizer to protect a focused work block."}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
