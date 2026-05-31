"use client";

import { useState } from "react";
import { Habit, PlanCategory } from "@/lib/types";

type HabitCardProps = {
  habit: Habit;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Omit<Habit, "id">>) => void;
};

export default function HabitCard({
  habit,
  onToggle,
  onDelete,
  onUpdate,
}: HabitCardProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(habit.name);
  const [category, setCategory] = useState<PlanCategory>(
    habit.category ?? "personal"
  );
  const [frequency, setFrequency] = useState<NonNullable<Habit["frequency"]>>(
    habit.frequency ?? "daily"
  );
  const [timePreference, setTimePreference] = useState<
    NonNullable<Habit["timePreference"]>
  >(habit.timePreference ?? "anytime");
  const [notes, setNotes] = useState(habit.notes ?? "");
  const today = new Date().toISOString().split("T")[0];
  const completedToday = habit.lastCompleted === today;

  if (editing) {
    return (
      <div className="rounded-xl border bg-white p-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-xl border px-3 py-2"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PlanCategory)}
            className="rounded-xl border px-3 py-2"
          >
            <option value="personal">Personal</option>
            <option value="fitness">Fitness</option>
            <option value="school">School</option>
            <option value="work">Work</option>
            <option value="health">Health</option>
            <option value="finance">Finance</option>
            <option value="other">Other</option>
          </select>
          <select
            value={frequency}
            onChange={(event) =>
              setFrequency(
                event.target.value as NonNullable<Habit["frequency"]>
              )
            }
            className="rounded-xl border px-3 py-2"
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="weekly">Weekly</option>
          </select>
          <select
            value={timePreference}
            onChange={(event) =>
              setTimePreference(
                event.target.value as NonNullable<Habit["timePreference"]>
              )
            }
            className="rounded-xl border px-3 py-2"
          >
            <option value="anytime">Anytime</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes"
          className="mt-2 min-h-20 w-full rounded-xl border px-3 py-2"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              onUpdate(habit.id, {
                name: name.trim() || habit.name,
                category,
                frequency,
                timePreference,
                notes,
              });
              setEditing(false);
            }}
            className="rounded-lg bg-gray-900 px-3 py-2 text-white"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border px-3 py-2"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{habit.name}</div>
        <div className="text-sm text-gray-500">
          {habit.category ?? "personal"} · {habit.frequency ?? "daily"} ·{" "}
          {habit.timePreference ?? "anytime"}
        </div>
        <div className="text-sm text-gray-500">Streak: {habit.streak}</div>
        <div className="text-sm text-gray-500">
          {completedToday ? "Completed today" : "Not completed today"}
        </div>
        {habit.notes && (
          <div className="mt-1 text-sm text-gray-500">{habit.notes}</div>
        )}
        {(habit.completionHistory ?? []).length > 0 && (
          <div className="mt-2 flex gap-1">
            {(habit.completionHistory ?? []).slice(-14).map((date) => (
              <span
                key={date}
                title={date}
                className="h-2 w-2 rounded-full bg-emerald-500"
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg border px-3 py-1"
        >
          Edit
        </button>

        <button
          onClick={() => onToggle(habit.id)}
          className="rounded-lg border px-3 py-1"
        >
          {completedToday ? "Done Today" : "Check in"}
        </button>

        <button
          onClick={() => onDelete(habit.id)}
          className="rounded-lg border px-3 py-1 text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
