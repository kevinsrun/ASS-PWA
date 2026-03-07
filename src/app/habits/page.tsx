"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import HabitCard from "@/components/HabitCard";

export default function HabitsPage() {
  const { habits, addHabit, toggleHabit, deleteHabit } = useAppContext();
  const [newHabit, setNewHabit] = useState("");

  function handleAddHabit() {
    addHabit(newHabit);
    setNewHabit("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleAddHabit();
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const completedTodayCount = habits.filter(
    (habit) => habit.lastCompleted === today
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Habits</h1>
        <p className="mt-2 text-gray-600">
          {completedTodayCount}/{habits.length} completed today
        </p>

        <div className="mt-6 flex gap-2">
          <input
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a habit..."
            className="flex-1 rounded-xl border bg-white px-4 py-3"
          />
          <button
            onClick={handleAddHabit}
            className="rounded-xl bg-black px-4 py-3 text-white"
          >
            Add
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onToggle={toggleHabit}
              onDelete={deleteHabit}
            />
          ))}

          {habits.length === 0 && (
            <div className="rounded-xl border bg-white p-4 text-gray-500">
              No habits yet.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}