"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import HabitCard from "@/components/HabitCard";

export default function HabitsPage() {
  const { habits, addHabit, toggleHabit, deleteHabit, updateHabit } =
    useAppContext();
  const [newHabit, setNewHabit] = useState("");
  const [category, setCategory] = useState("personal");
  const [frequency, setFrequency] = useState("daily");

  function handleAddHabit() {
    addHabit(newHabit, {
      category: category as never,
      frequency: frequency as never,
    });
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
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold text-emerald-950">Habits</h1>
        <p className="mt-2 text-gray-600">
          {completedTodayCount}/{habits.length} completed today
        </p>

        <div className="ios-card mt-6 flex flex-wrap gap-2 rounded-3xl p-4">
          <input
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a habit..."
            className="min-h-12 flex-1 rounded-xl border bg-white px-4 py-3"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="min-h-12 rounded-xl border bg-white px-4 py-3"
          >
            <option value="personal">Personal</option>
            <option value="fitness">Fitness</option>
            <option value="school">School</option>
            <option value="work">Work</option>
            <option value="health">Health</option>
          </select>
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            className="min-h-12 rounded-xl border bg-white px-4 py-3"
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="weekly">Weekly</option>
          </select>
          <button
            onClick={handleAddHabit}
            className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-white"
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
              onUpdate={updateHabit}
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
