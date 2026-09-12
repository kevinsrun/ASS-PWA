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
      <div className="editor-card">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="ass-input w-full"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PlanCategory)}
            className="ass-select"
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
            className="ass-select"
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
            className="ass-select"
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
          className="ass-input mt-2 min-h-20 w-full"
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
            className="ass-primary-button"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="ass-secondary-button"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reminder-row">
      <button
        type="button"
        className={`reminder-check ${completedToday ? "is-done" : ""}`}
        onClick={() => onToggle(habit.id)}
        aria-label={completedToday ? `${habit.name} completed today` : `Complete ${habit.name}`}
      />
      <div className="reminder-copy">
        <div className="font-medium">{habit.name}</div>
        <span>
          {habit.category ?? "personal"} · {habit.frequency ?? "daily"} ·{" "}
          {habit.timePreference ?? "anytime"}
          {habit.streak > 0 ? ` · ${habit.streak} day streak` : ""}
        </span>
      </div>

      <div className="row-actions">
        <button
          onClick={() => setEditing(true)}
          className="quiet-action"
        >
          Edit
        </button>

        <button
          onClick={() => onDelete(habit.id)}
          className="quiet-action is-destructive"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
