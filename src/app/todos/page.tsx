"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import TaskCard from "@/components/TaskCard";

export default function TodosPage() {
  const { todos, addTodo, toggleTodo, deleteTodo } = useAppContext();
  const [newTodo, setNewTodo] = useState("");

  function handleAddTodo() {
    addTodo(newTodo);
    setNewTodo("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    handleAddTodo();
  }
}

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">To-Dos</h1>
        <p className="mt-2 text-gray-600">Track tasks across the whole app.</p>

        <div className="mt-6 flex gap-2">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="Add a task..."
            className="flex-1 rounded-xl border bg-white px-4 py-3"
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={handleAddTodo}
            className="rounded-xl bg-black px-4 py-3 text-white"
          >
            Add
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {todos.map((todo) => (
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