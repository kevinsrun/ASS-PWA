import { Habit, PlanBlock, Todo } from "@/lib/types";
import {
  addMinutesToClock,
  formatTimeLabel,
  getTodayString,
} from "@/lib/dateTime";

const priorityRank = {
  high: 0,
  medium: 1,
  low: 2,
};

function formatRange(start: string, duration: number) {
  const startLabel = formatTimeLabel(start);
  const endClock = addMinutesToClock(start, duration);
  const endLabel = formatTimeLabel(endClock);
  return `${startLabel} - ${endLabel}`;
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

export function buildPlanBlocks(todos: Todo[], habits: Habit[]): PlanBlock[] {
  const today = getTodayString();
  const textBlocks = buildTimeBlocks(todos, habits);

  return textBlocks.map((block, index) => {
    const [timeRange, titlePart] = block.split("  ");
    const [startLabel, endLabel] = timeRange.split(" - ");

    return {
      id: `plan-${index}`,
      title: titlePart ?? block,
      date: today,
      startLabel,
      endLabel,
      recurrence: "none",
    };
  });
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
