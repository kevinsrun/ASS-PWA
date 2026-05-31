export type Todo = {
  id: number;
  title: string;
  done: boolean;
  priority: "low" | "medium" | "high";
  duration: number;
  dueDate: string | null;
  tags?: string[];
  recurrence?: PlanRecurrence;
  subtasks?: Array<{
    id: number;
    title: string;
    done: boolean;
  }>;
};

export type PlanCategory =
  | "school"
  | "fitness"
  | "work"
  | "health"
  | "personal"
  | "finance"
  | "other";

export type PlanRecurrence =
  | "none"
  | "daily"
  | "weekly"
  | "weekdays"
  | "weekends"
  | "custom";

export type PlanPriority = "low" | "medium" | "high";

export type SavedPlan = {
  id: number;
  title: string;
  date: string;
  startLabel: string;
  endLabel: string;
  recurrence: PlanRecurrence;
  category?: PlanCategory;
  priority?: PlanPriority;
  notes?: string;
  customRecurrence?: string;
  seriesId?: string;
  excludedDates?: string[];
};

export type PlanBlock = {
  id: string;
  title: string;
  date: string;
  startLabel: string;
  endLabel: string;
  recurrence: PlanRecurrence;
};

export type Habit = {
  id: number;
  name: string;
  lastCompleted: string | null;
  streak: number;
  category?: PlanCategory;
  frequency?: "daily" | "weekdays" | "weekends" | "weekly";
  timePreference?: "morning" | "afternoon" | "evening" | "anytime";
  notes?: string;
  skipDays?: string[];
  completionHistory?: string[];
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
  createdAt?: string;
};

export type CodingWorkflow = {
  id: number;
  title: string;
  repo: string;
  branchPrefix: string;
  objective: string;
  sourceContext: Array<"journal" | "chat" | "todos" | "calendar" | "habits">;
  guardrails: string[];
  status: "draft" | "approved" | "running" | "review";
  createdAt: string;
  generatedPrompt: string;
};

export type ProfileSettings = {
  displayName: string;
  primaryEmail: string;
  githubUsername: string;
  githubRepo: string;
  githubConnected: boolean;
  gmailConnected: boolean;
  outlookConnected: boolean;
};

export type JournalEntry = {
  id: number;
  date: string;
  content: string;
  mood?: string;
  energy?: number;
  themes?: string[];
  locked?: boolean;
};

export type JournalSuggestion = {
  type: "todo" | "habit" | "plan";
  title: string;
  time?: string | null;
  duration?: number;
  recurrence?: PlanRecurrence | null;
  priority?: PlanPriority;
  notes?: string;
  mood?: string;
  stress?: "low" | "medium" | "high";
  deadline?: string | null;
  intention?: string | null;
};
