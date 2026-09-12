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
      <div className="editor-card">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="ass-input mb-2 w-full"
          placeholder="Task title"
        />

        <div className="mb-2 flex flex-wrap gap-2">
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as "low" | "medium" | "high")
            }
            className="ass-select"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="ass-input w-24"
          />

          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="ass-input"
          />

          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as PlanRecurrence)}
            className="ass-select"
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
          className="ass-input mb-2 w-full"
          placeholder="Tags, comma separated"
        />

        <div className="editor-subgroup">
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
              className="ass-input flex-1"
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
              className="ass-secondary-button"
            >
              Add
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={saveEdit}
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
        className={`reminder-check ${todo.done ? "is-done" : ""}`}
        onClick={() => onToggle(todo.id)}
        aria-label={todo.done ? `Mark ${todo.title} incomplete` : `Complete ${todo.title}`}
      />
      <div className="reminder-copy">
        <div className={todo.done ? "line-through text-gray-400" : ""}>
          {todo.title}
        </div>
        <span>
          {[todo.dueDate, `${todo.duration} min`, todo.recurrence !== "none" ? todo.recurrence : null]
            .filter(Boolean)
            .join(" · ")}
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
          onClick={() => onDelete(todo.id)}
          className="quiet-action is-destructive"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
