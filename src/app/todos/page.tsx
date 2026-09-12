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
      <main className="simple-page">
        <div className="project-page-heading">
          <div><p className="ass-kicker">Projects</p><h1>Tasks</h1></div>
          <nav aria-label="More project areas">
            <a href="/academics">Academics</a><a href="/habits">Habits</a><a href="/journal">Journal</a>
          </nav>
        </div>

        <div className="capture-bar">
          <input
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            className="ass-input flex-1"
          />

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
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="ass-input"
          />

          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="ass-input w-28"
            aria-label="Duration in minutes"
          />

          <button
            onClick={handleAddTodo}
            className="ass-primary-button"
          >
            Add
          </button>
        </div>

        <div className="task-sections">
          {[
            ["Overdue", overdueTodos],
            ["Today", todayTodos],
            ["Later", laterTodos],
          ].map(([label, items]) => (
            <section key={label as string}>
              <h2>{label as string}</h2>
              <div className="simple-list">
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
                      className="quiet-action"
                    >
                      Convert to calendar event
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {todos.length === 0 && (
            <div className="quiet-empty">
              No to-dos yet.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
