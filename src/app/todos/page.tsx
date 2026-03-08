"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import TaskCard from "@/components/TaskCard";

export default function TodosPage() {
  const { todos, addTodo, toggleTodo, deleteTodo } = useAppContext();
  const [newTodo, setNewTodo] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [duration, setDuration] = useState(60);

  function handleAddTodo() {
    addTodo(newTodo, priority, duration);
    setNewTodo("");
    setPriority("medium");
    setDuration(60);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleAddTodo();
    }
  }

  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const sortedTodos = [...todos].sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority]
  );

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">To-Dos</h1>
        <p className="mt-2 text-gray-600">Track tasks across the whole app.</p>

        <div className="mt-6 flex gap-2">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            className="flex-1 rounded-xl border bg-white px-4 py-3"
          />

          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as "low" | "medium" | "high")
            }
            className="rounded-xl border bg-white px-4 py-3"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="rounded-xl border bg-white px-4 py-3"
          >
            <option value={30}>30m</option>
            <option value={45}>45m</option>
            <option value={60}>1h</option>
            <option value={90}>1h 30m</option>
            <option value={120}>2h</option>
          </select>

          <button
            onClick={handleAddTodo}
            className="rounded-xl bg-gray-900 px-4 py-3 text-white"
          >
            Add
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {sortedTodos.map((todo) => (
            <TaskCard
              key={todo.id}
              todo={todo}
              onToggle={toggleTodo}
              onDelete={deleteTodo}
            />
          ))}

          {todos.length === 0 && (
            <div className="rounded-xl border bg-white p-4 text-gray-500">
              No to-dos yet.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}