"use client";

import { Habit } from "@/lib/types";

type HabitCardProps = {
  habit: Habit;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
};

export default function HabitCard({
  habit,
  onToggle,
  onDelete,
}: HabitCardProps) {
  const today = new Date().toISOString().split("T")[0];
  const completedToday = habit.lastCompleted === today;

  return (
    <div className="flex items-center justify-between rounded-xl border bg-white p-4">
      <div>
        <div className="font-medium">{habit.name}</div>
        <div className="text-sm text-gray-500">Streak: {habit.streak}</div>
        <div className="text-sm text-gray-500">
          {completedToday ? "Completed today" : "Not completed today"}
        </div>
      </div>

      <div className="flex gap-2">
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