"use client";

import { Todo } from "@/lib/types";

type TaskCardProps = {
  todo: Todo;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
};

export default function TaskCard({
  todo,
  onToggle,
  onDelete,
}: TaskCardProps) {
return (
  <div className="flex items-center justify-between rounded-xl border bg-white p-4">
    <div>
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
      </div>
    </div>

    <div className="flex gap-2">
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