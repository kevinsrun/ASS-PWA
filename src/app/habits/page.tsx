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
      <main className="simple-page">
        <header className="simple-header">
        <span>Projects</span>
        <h1>Habits</h1>
        <p>
          {completedTodayCount}/{habits.length} completed today
        </p>
        </header>

        <div className="capture-bar">
          <input
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a habit..."
            className="ass-input flex-1"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="ass-select"
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
            className="ass-select"
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="weekly">Weekly</option>
          </select>
          <button
            onClick={handleAddHabit}
            className="ass-primary-button"
          >
            Add
          </button>
        </div>

        <div className="simple-list">
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
            <div className="quiet-empty">
              No habits yet.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
