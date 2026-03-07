export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export type Habit = {
  id: number;
  name: string;
  lastCompleted: string | null;
  streak: number;
};

export type CalendarBlock = {
  id: number;
  title: string;
  start: string;
  end: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};