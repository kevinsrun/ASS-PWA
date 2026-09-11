"use client";

import { useState } from "react";
import { useAppContext } from "@/providers/AppProvider";
import TaskCard from "@/components/TaskCard";
import { addMinutesToLabel } from "@/lib/dateTime";

export default function TodosPage() {
  const { todos, addTodo, toggleTodo, deleteTodo, updateTodo, addPlan } =
    useAppContext();
  const [newTodo, setNewTodo] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [duration, setDuration] = useState(60);
  const [dueDate, setDueDate] = useState("");

  function handleAddTodo() {
    addTodo(newTodo, priority, duration, dueDate || null);
    setNewTodo("");
    setPriority("medium");
    setDuration(60);
    setDueDate("");
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
  const today = new Date().toISOString().split("T")[0];
  const overdueTodos = sortedTodos.filter(
    (todo) => !todo.done && todo.dueDate && todo.dueDate < today
  );
  const todayTodos = sortedTodos.filter(
    (todo) => !todo.done && todo.dueDate === today
  );
  const laterTodos = sortedTodos.filter(
    (todo) => !todo.done && todo.dueDate !== today && !(todo.dueDate && todo.dueDate < today)
  );

  function convertToCalendar(todoId: number) {
    const todo = todos.find((candidate) => candidate.id === todoId);
    if (!todo) return;

    addPlan({
      title: todo.title,
      date: todo.dueDate ?? today,
      startLabel: "9:00 AM",
      endLabel: addMinutesToLabel("09:00", todo.duration),
      recurrence: todo.recurrence ?? "none",
      category: "work",
      priority: todo.priority,
      notes: `Converted from todo${(todo.tags ?? []).length ? `: ${todo.tags?.join(", ")}` : ""}`,
    });
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="project-page-heading">
          <div><p className="ass-kicker">Projects</p><h1>Tasks</h1></div>
          <nav aria-label="More project areas">
            <a href="/academics">Academics</a><a href="/habits">Habits</a><a href="/journal">Journal</a>
          </nav>
        </div>

        <div className="task-capture mt-6 flex flex-wrap gap-2">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            className="min-h-12 flex-1 rounded-xl border bg-white px-4 py-3"
          />

          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as "low" | "medium" | "high")
            }
            className="min-h-12 rounded-xl border bg-white px-4 py-3"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>

          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="min-h-12 rounded-xl border bg-white px-4 py-3"
          />

          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="min-h-12 w-28 rounded-xl border bg-white px-4 py-3"
            aria-label="Duration in minutes"
          />

          <button
            onClick={handleAddTodo}
            className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-white"
          >
            Add
          </button>
        </div>

        <div className="mt-6 space-y-6">
          {[
            ["Overdue", overdueTodos],
            ["Today", todayTodos],
            ["Later", laterTodos],
          ].map(([label, items]) => (
            <section key={label as string}>
              <h2 className="text-lg font-semibold">{label as string}</h2>
              <div className="mt-3 space-y-3">
                {(items as typeof todos).map((todo) => (
                  <div key={todo.id}>
                    <TaskCard
                      todo={todo}
                      onToggle={toggleTodo}
                      onDelete={deleteTodo}
                      onUpdate={updateTodo}
                    />
                    <button
                      onClick={() => convertToCalendar(todo.id)}
                      className="mt-2 rounded-lg border px-3 py-1 text-sm text-indigo-700"
                    >
                      Convert to calendar event
                    </button>
                  </div>
                ))}
              </div>
            </section>
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
