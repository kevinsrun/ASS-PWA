"use client";

import Link from "next/link";
import { useAppContext } from "@/providers/AppProvider";

export default function Home() {
  const { todos, habits } = useAppContext();

  const completedTodos = todos.filter((todo) => todo.done).length;
  const completedHabits = habits.filter((habit) => habit.completedToday).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold">ASS Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Task manager, habit tracker, calendar planner, and AI assistant.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/todos"
            className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Todos</h2>
            <p className="mt-2 text-gray-600">
              {completedTodos}/{todos.length} completed
            </p>
          </Link>

          <Link
            href="/habits"
            className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Habits</h2>
            <p className="mt-2 text-gray-600">
              {completedHabits}/{habits.length} checked in today
            </p>
          </Link>

          <Link
            href="/calendar"
            className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">Calendar</h2>
            <p className="mt-2 text-gray-600">Schedule tasks and events</p>
          </Link>

          <Link
            href="/chat"
            className="rounded-xl border bg-white p-5 shadow-sm hover:shadow-md"
          >
            <h2 className="text-xl font-semibold">AI Chat</h2>
            <p className="mt-2 text-gray-600">Plan your day with your data</p>
          </Link>
        </div>
      </main>
    </div>
  );
}