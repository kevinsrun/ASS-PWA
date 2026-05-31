"use client";

import { useState } from "react";
import { PlanRecurrence, Todo } from "@/lib/types";

type TaskCardProps = {
  todo: Todo;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Omit<Todo, "id">>) => void;
};

export default function TaskCard({
  todo,
  onToggle,
  onDelete,
  onUpdate,
}: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [priority, setPriority] = useState(todo.priority);
  const [duration, setDuration] = useState(todo.duration);
  const [dueDate, setDueDate] = useState(todo.dueDate ?? "");
  const [tags, setTags] = useState((todo.tags ?? []).join(", "));
  const [recurrence, setRecurrence] = useState<PlanRecurrence>(
    todo.recurrence ?? "none"
  );
  const [subtasks, setSubtasks] = useState(todo.subtasks ?? []);
  const [newSubtask, setNewSubtask] = useState("");

  function saveEdit() {
    onUpdate(todo.id, {
      title: title.trim() || todo.title,
      priority,
      duration,
      dueDate: dueDate || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      recurrence,
      subtasks,
    });

    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-xl border bg-white p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-2 w-full rounded-xl border px-3 py-2"
          placeholder="Task title"
        />

        <div className="mb-2 flex flex-wrap gap-2">
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as "low" | "medium" | "high")
            }
            className="rounded-xl border px-3 py-2"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-24 rounded-xl border px-3 py-2"
          />

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-xl border px-3 py-2"
          />

          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as PlanRecurrence)}
            className="rounded-xl border px-3 py-2"
          >
            <option value="none">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="mb-2 w-full rounded-xl border px-3 py-2"
          placeholder="Tags, comma separated"
        />

        <div className="mb-3 rounded-xl border p-3">
          <div className="mb-2 text-sm font-medium">Subtasks</div>
          <div className="space-y-2">
            {subtasks.map((subtask) => (
              <label key={subtask.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={subtask.done}
                  onChange={() =>
                    setSubtasks((prev) =>
                      prev.map((item) =>
                        item.id === subtask.id
                          ? { ...item, done: !item.done }
                          : item
                      )
                    )
                  }
                />
                {subtask.title}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newSubtask}
              onChange={(event) => setNewSubtask(event.target.value)}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              placeholder="Add subtask"
            />
            <button
              onClick={() => {
                const trimmed = newSubtask.trim();
                if (!trimmed) return;
                setSubtasks((prev) => [
                  ...prev,
                  { id: Date.now(), title: trimmed, done: false },
                ]);
                setNewSubtask("");
              }}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              Add
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveEdit}
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
        <div className={todo.done ? "line-through text-gray-400" : ""}>
          {todo.title}
        </div>

        <div className="text-sm text-gray-500 capitalize">
          Priority: {todo.priority}
        </div>

        <div className="text-sm text-gray-500">
          Duration: {todo.duration} min
        </div>

        {todo.recurrence && todo.recurrence !== "none" && (
          <div className="text-sm text-gray-500 capitalize">
            Repeats: {todo.recurrence}
          </div>
        )}

        {todo.dueDate && (
          <div className="text-sm text-gray-500">
            Due: {todo.dueDate}
          </div>
        )}

        {(todo.tags ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {todo.tags?.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {(todo.subtasks ?? []).length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            {todo.subtasks?.filter((subtask) => subtask.done).length}/
            {todo.subtasks?.length} subtasks
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
          onClick={() => onToggle(todo.id)}
          className="rounded-lg border px-3 py-1"
        >
          {todo.done ? "Undo" : "Done"}
        </button>

        <button
          onClick={() => onDelete(todo.id)}
          className="rounded-lg border px-3 py-1 text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
