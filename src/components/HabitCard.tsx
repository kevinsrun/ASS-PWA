"use client";

import { useState } from "react";
import { Habit } from "@/lib/types";

type Props = {
  habit: Habit;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Omit<Habit, "id">>) => void;
};

const today = () => new Date().toISOString().split("T")[0];

export default function HabitCard({ habit, onToggle, onDelete, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(habit.name);
  const [targetType, setTargetType] = useState(habit.targetType ?? "binary");
  const [targetAmount, setTargetAmount] = useState(habit.targetAmount ?? 1);
  const [unit, setUnit] = useState(habit.unit ?? "");
  const done = habit.lastCompleted === today();

  if (editing) {
    return (
      <div className="habit-detail-card">
        <label className="sr-only" htmlFor={`habit-name-${habit.id}`}>Habit name</label>
        <input id={`habit-name-${habit.id}`} value={name} onChange={(event) => setName(event.target.value)} className="ass-input w-full" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-sm text-[var(--muted)]">
            Type
            <select value={targetType} onChange={(event) => setTargetType(event.target.value as NonNullable<Habit["targetType"]>)} className="ass-select mt-1 w-full">
              <option value="binary">Binary</option>
              <option value="count">Count</option>
              <option value="duration">Duration</option>
              <option value="frequency">Frequency</option>
            </select>
          </label>
          {targetType !== "binary" && (
            <label className="text-sm text-[var(--muted)]">
              Target
              <input type="number" min="1" value={targetAmount} onChange={(event) => setTargetAmount(Math.max(1, Number(event.target.value)))} className="ass-input mt-1 w-full" />
            </label>
          )}
          {targetType !== "binary" && (
            <label className="text-sm text-[var(--muted)]">
              Unit
              <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder={targetType === "duration" ? "minutes" : "times"} className="ass-input mt-1 w-full" />
            </label>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <button className="ass-primary-button" onClick={() => { onUpdate(habit.id, { name: name.trim() || habit.name, targetType, targetAmount, unit }); setEditing(false); }}>Save</button>
          <button className="ass-secondary-button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const target = habit.targetType === "binary" || !habit.targetType
    ? "Once today"
    : `${habit.targetAmount ?? 1} ${habit.unit || (habit.targetType === "duration" ? "minutes" : "times")}`;

  return (
    <article className={`habit-row ${done ? "is-complete" : ""} ${habit.paused ? "is-paused" : ""}`}>
      <button type="button" className={`habit-check ${done ? "is-done" : ""}`} onClick={() => onToggle(habit.id)} aria-label={done ? `Undo ${habit.name}` : `Complete ${habit.name}`}>
        {done ? "✓" : ""}
      </button>
      <button type="button" className="habit-row-main" onClick={() => setEditing(true)}>
        <strong>{habit.name}</strong>
        <span>{target} · {habit.streak > 0 ? `${habit.streak} day streak` : "Not started"}</span>
      </button>
      <button type="button" className="quiet-action" onClick={() => onUpdate(habit.id, { paused: !habit.paused })} aria-label={habit.paused ? `Resume ${habit.name}` : `Pause ${habit.name}`}>
        {habit.paused ? "Resume" : "Pause"}
      </button>
      <button type="button" className="quiet-action is-destructive" onClick={() => onDelete(habit.id)} aria-label={`Delete ${habit.name}`}>Delete</button>
    </article>
  );
}
