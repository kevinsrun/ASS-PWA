"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Todo, Habit } from "@/lib/types";
import { loadTodos, saveTodos, loadHabits, saveHabits } from "@/lib/storage";

type AppContextType = {
  todos: Todo[];
  habits: Habit[];
  addTodo: (title: string) => void;
  toggleTodo: (id: number) => void;
  deleteTodo: (id: number) => void;
  addHabit: (name: string) => void;
  toggleHabit: (id: number) => void;
  deleteHabit: (id: number) => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);

 useEffect(() => {
  setTodos(loadTodos());
  setHabits(loadHabits());
}, []);

useEffect(() => {
  saveTodos(todos);
}, [todos]);

useEffect(() => {
  saveHabits(habits);
}, [habits]);

  function addTodo(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;

    setTodos((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: trimmed,
        done: false,
      },
    ]);
  }

  function toggleTodo(id: number) {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo
      )
    );
  }

  function deleteTodo(id: number) {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  }

  function addHabit(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;

  setHabits((prev) => [
    ...prev,
    {
      id: Date.now(),
      name: trimmed,
      lastCompleted: null,
      streak: 0,
    },
  ]);
}

  function toggleHabit(id: number) {
  const today = new Date().toISOString().split("T")[0];

  setHabits((prev) =>
    prev.map((habit) => {
      if (habit.id !== id) return habit;

      if (habit.lastCompleted === today) {
        return habit;
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayString = yesterday.toISOString().split("T")[0];

      const newStreak =
        habit.lastCompleted === yesterdayString ? habit.streak + 1 : 1;

      return {
        ...habit,
        lastCompleted: today,
        streak: newStreak,
      };
    })
  );
}

  function deleteHabit(id: number) {
    setHabits((prev) => prev.filter((habit) => habit.id !== id));
  }

  const value = useMemo(
    () => ({
      todos,
      habits,
      addTodo,
      toggleTodo,
      deleteTodo,
      addHabit,
      toggleHabit,
      deleteHabit,
    }),
    [todos, habits]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider");
  }

  return context;
}