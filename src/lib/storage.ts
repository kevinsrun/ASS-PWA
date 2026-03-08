import { Todo, Habit } from "./types";

const TODOS_KEY = "ass_todos";
const HABITS_KEY = "ass_habits";

/* TODOS */

export function loadTodos(): Todo[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(TODOS_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw);

  return parsed.map((todo: any) => ({
    id: todo.id,
    title: todo.title,
    done: todo.done,
    priority: todo.priority ?? "medium",
    duration: todo.duration ?? 60,
  }));
}

export function saveTodos(todos: Todo[]) {
  localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
}

/* HABITS */

export function loadHabits(): Habit[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(HABITS_KEY);
  if (!raw) return [];

  const parsed = JSON.parse(raw);

  return parsed.map((habit: any) => ({
    id: habit.id,
    name: habit.name,
    lastCompleted: habit.lastCompleted ?? null,
    streak: habit.streak ?? 0,
  }));
}

export function saveHabits(habits: Habit[]) {
  localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
}