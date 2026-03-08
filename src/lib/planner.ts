import { Habit, Todo } from "@/lib/types";

const priorityRank = {
  high: 0,
  medium: 1,
  low: 2,
};

function formatStart(time: string) {
  const [hourStr, minuteStr] = time.split(":");
  const hours = Number(hourStr);
  const mins = minuteStr.padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${mins} ${suffix}`;
}

function addMinutesToClock(time: string, minutes: number) {
  const [hourStr, minuteStr] = time.split(":");
  const date = new Date();
  date.setHours(Number(hourStr), Number(minuteStr), 0, 0);
  date.setMinutes(date.getMinutes() + minutes);

  const hours = date.getHours().toString().padStart(2, "0");
  const mins = date.getMinutes().toString().padStart(2, "0");

  return `${hours}:${mins}`;
}

function formatRange(start: string, duration: number) {
  const startLabel = formatStart(start);
  const endClock = addMinutesToClock(start, duration);
  const endLabel = formatStart(endClock);
  return `${startLabel} - ${endLabel}`;
}

export function getTodayString() {
  return new Date().toISOString().split("T")[0];
}

export function getPendingHabits(habits: Habit[]) {
  const today = getTodayString();
  return habits.filter((habit) => habit.lastCompleted !== today);
}

export function getIncompleteTodos(todos: Todo[]) {
  return [...todos]
    .filter((todo) => !todo.done)
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}

export function buildTimeBlocks(todos: Todo[], habits: Habit[]) {
  const pendingHabits = getPendingHabits(habits);
  const incompleteTodos = getIncompleteTodos(todos);

  const blocks: string[] = [];
  let currentTime = "08:00";

  pendingHabits.forEach((habit) => {
    const range = formatRange(currentTime, 30);
    blocks.push(`${range}  ${habit.name} (habit)`);
    currentTime = addMinutesToClock(currentTime, 45);
  });

  incompleteTodos.forEach((todo) => {
    const duration = todo.duration;
    const range = formatRange(currentTime, duration);
    blocks.push(`${range}  ${todo.title} [${todo.priority}]`);
    currentTime = addMinutesToClock(currentTime, duration + 15);
  });

  return blocks;
}