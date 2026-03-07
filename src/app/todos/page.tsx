"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/NavBar";

type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");

  // Load todos from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("ass-todos");
    if (saved) {
      setTodos(JSON.parse(saved));
    }
  }, []);

  // Save todos whenever they change
  useEffect(() => {
    localStorage.setItem("ass-todos", JSON.stringify(todos));
  }, [todos]);

  function addTodo() {
    if (!newTodo.trim()) return;

    const todo: Todo = {
      id: Date.now(),
      title: newTodo,
      done: false,
    };

    setTodos([...todos, todo]);
    setNewTodo("");
  }

  function toggleTodo(id: number) {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo
      )
    );
  }

  function deleteTodo(id: number) {
    setTodos(todos.filter((todo) => todo.id !== id));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Todos</h1>

        <div className="mt-6 flex gap-2">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            placeholder="Add a task..."
            className="flex-1 rounded-xl border px-4 py-3"
          />
          <button
            onClick={addTodo}
            className="rounded-xl bg-black px-4 py-3 text-white"
          >
            Add
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className="flex items-center justify-between rounded-xl border bg-white p-4"
            >
              <span
                className={todo.done ? "line-through text-gray-400" : ""}
              >
                {todo.title}
              </span>

              <div className="flex gap-2">
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className="rounded-lg border px-3 py-1"
                >
                  {todo.done ? "Undo" : "Done"}
                </button>

                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="rounded-lg border px-3 py-1 text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}