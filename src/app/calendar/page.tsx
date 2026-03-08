"use client";

import { useAppContext } from "@/providers/AppProvider";
import {
  buildTimeBlocks,
  getIncompleteTodos,
  getPendingHabits,
  getTodayString,
} from "@/lib/planner";

export default function CalendarPage() {
  const { todos, habits } = useAppContext();

  const today = getTodayString();
  const incompleteTodos = getIncompleteTodos(todos);
  const pendingHabits = getPendingHabits(habits);
  const timeBlocks = buildTimeBlocks(todos, habits);

  const completedHabitsToday = habits.filter(
    (habit) => habit.lastCompleted === today
  ).length;

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Calendar</h1>
        <p className="mt-2 text-gray-600">Suggested plan for today</p>

        <div className="mt-8 space-y-8">
          <section>
            <h2 className="text-lg font-semibold">Today&apos;s Habits</h2>
            <p className="mt-1 text-sm text-gray-500">
              {completedHabitsToday}/{habits.length} completed today
            </p>

            <div className="mt-4 space-y-3">
              {habits.map((habit) => {
                const completedToday = habit.lastCompleted === today;

                return (
                  <div
                    key={habit.id}
                    className="flex items-center justify-between rounded-xl border bg-white p-4"
                  >
                    <div>
                      <div className="font-medium">{habit.name}</div>
                      <div className="text-sm text-gray-500">
                        Streak: {habit.streak}
                      </div>
                    </div>

                    <span className="text-sm text-gray-500">
                      {completedToday ? "Completed" : "Pending"}
                    </span>
                  </div>
                );
              })}

              {habits.length === 0 && (
                <div className="rounded-xl border bg-white p-4 text-gray-500">
                  No habits yet.
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Priority To-Dos</h2>
            <p className="mt-1 text-sm text-gray-500">
              {incompleteTodos.length} unfinished task(s), {pendingHabits.length} pending habit(s)
            </p>

            <div className="mt-4 space-y-3">
              {incompleteTodos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-center justify-between rounded-xl border bg-white p-4"
                >
                  <div>
                    <div className="font-medium">{todo.title}</div>
                    <div className="text-sm text-gray-500 capitalize">
                      Priority: {todo.priority}
                    </div>
                  </div>

                  <span className="text-sm text-gray-500">Not done</span>
                </div>
              ))}

              {incompleteTodos.length === 0 && (
                <div className="rounded-xl border bg-white p-4 text-gray-500">
                  No unfinished to-dos.
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Suggested Time Blocks</h2>

            <div className="mt-4 space-y-3">
              {timeBlocks.map((block, index) => (
                <div
                  key={index}
                  className="rounded-xl border bg-white p-4 text-sm text-gray-800"
                >
                  {block}
                </div>
              ))}

              {timeBlocks.length === 0 && (
                <div className="rounded-xl border bg-white p-4 text-gray-500">
                  Nothing to schedule right now.
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}