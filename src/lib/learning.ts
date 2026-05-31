import { Habit, JournalEntry, PlanCategory, SavedPlan, Todo } from "@/lib/types";
import { labelToMinutes } from "@/lib/dateTime";

export type LearningProfile = {
  preferredCategory: PlanCategory;
  preferredTimeOfDay: "morning" | "afternoon" | "evening";
  workload: "light" | "balanced" | "heavy";
  stressSignals: string[];
  themeSignals: string[];
  completionRate: number;
  habitRate: number;
  guiDensity: "calm" | "balanced" | "dense";
  accent: PlanCategory;
  strategies: Array<{
    id: string;
    title: string;
    body: string;
    action: string;
  }>;
};

function timeBucket(minutes: number) {
  if (minutes < 12 * 60) return "morning";
  if (minutes < 17 * 60) return "afternoon";
  return "evening";
}

function mostCommon<T extends string>(values: T[], fallback: T) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

  return (winner as T | undefined) ?? fallback;
}

function detectStress(journals: JournalEntry[]) {
  const text = journals
    .slice(-10)
    .map((journal) => journal.content)
    .join(" ")
    .toLowerCase();
  const signals = [
    ["overwhelmed", "Overwhelm"],
    ["behind", "Behind"],
    ["tired", "Low energy"],
    ["anxious", "Anxiety"],
    ["deadline", "Deadline pressure"],
    ["stressed", "Stress"],
  ];

  return signals
    .filter(([word]) => text.includes(word))
    .map(([, label]) => label);
}

function collectThemes(journals: JournalEntry[]) {
  return journals
    .flatMap((journal) => journal.themes ?? [])
    .filter(Boolean)
    .slice(-12);
}

export function buildLearningProfile(input: {
  todos: Todo[];
  habits: Habit[];
  journals: JournalEntry[];
  plans: SavedPlan[];
}): LearningProfile {
  const { todos, habits, journals, plans } = input;
  const completedTodos = todos.filter((todo) => todo.done).length;
  const completionRate = todos.length ? completedTodos / todos.length : 0;
  const today = new Date().toISOString().split("T")[0];
  const completedHabits = habits.filter(
    (habit) => habit.lastCompleted === today
  ).length;
  const habitRate = habits.length ? completedHabits / habits.length : 0;
  const preferredCategory = mostCommon(
    plans.map((plan) => plan.category ?? "other"),
    "personal"
  );
  const preferredTimeOfDay = mostCommon(
    plans.map((plan) => timeBucket(labelToMinutes(plan.startLabel))),
    "morning"
  );
  const scheduledToday = plans.filter((plan) => plan.date === today).length;
  const workload =
    scheduledToday + todos.filter((todo) => !todo.done).length > 12
      ? "heavy"
      : scheduledToday > 4
      ? "balanced"
      : "light";
  const stressSignals = detectStress(journals);
  const themeSignals = collectThemes(journals);
  const guiDensity =
    stressSignals.length > 1 || workload === "heavy"
      ? "calm"
      : completionRate > 0.7
      ? "dense"
      : "balanced";
  const strategies = [];

  if (workload === "heavy") {
    strategies.push({
      id: "reduce-load",
      title: "Protect breathing room",
      body: "Your schedule looks packed. Keep one unscheduled block before adding more work.",
      action: "Use the optimizer only for high-priority tasks.",
    });
  }

  if (completionRate < 0.45 && todos.length > 3) {
    strategies.push({
      id: "smaller-tasks",
      title: "Shrink the next step",
      body: "Completion is lagging. Break the next task into a subtask you can finish in 15 minutes.",
      action: "Add one tiny subtask to the oldest open todo.",
    });
  }

  if (habitRate < 0.5 && habits.length > 0) {
    strategies.push({
      id: "habit-anchor",
      title: "Anchor habits earlier",
      body: "Pending habits tend to slip when they are not attached to a time block.",
      action: `Schedule one habit in the ${preferredTimeOfDay}.`,
    });
  }

  if (stressSignals.length > 0) {
    strategies.push({
      id: "stress-buffer",
      title: "Lower friction mode",
      body: `Recent journal signals mention ${stressSignals.join(", ")}.`,
      action: "Use calm density and avoid back-to-back blocks.",
    });
  }

  if (strategies.length === 0) {
    strategies.push({
      id: "maintain",
      title: "Keep the current rhythm",
      body: "Your current data looks stable. Keep using the same planning pattern and review weekly.",
      action: "Add one intentional focus block.",
    });
  }

  return {
    preferredCategory,
    preferredTimeOfDay,
    workload,
    stressSignals,
    themeSignals,
    completionRate,
    habitRate,
    guiDensity,
    accent: preferredCategory,
    strategies,
  };
}
