import {
  ChatMessage,
  CodingWorkflow,
  Habit,
  JournalEntry,
  ProfileSettings,
  SavedPlan,
  Todo,
} from "@/lib/types";

const TODOS_KEY = "ass_todos";
const HABITS_KEY = "ass_habits";
const JOURNALS_KEY = "ass_journals";
const PLANS_KEY = "ass_plans";
const CHAT_MESSAGES_KEY = "ass_chat_messages";
const CODING_WORKFLOWS_KEY = "ass_coding_workflows";
const PROFILE_KEY = "ass_profile";

function parseStoredArray<T>(key: string, normalize: (value: Partial<T>) => T) {
  if (typeof window === "undefined") return [];

  const raw = localStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item) => normalize(item as Partial<T>));
  } catch {
    return [];
  }
}

function saveStoredArray<T>(key: string, items: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(items));
}

export function loadTodos(): Todo[] {
  return parseStoredArray<Todo>(TODOS_KEY, (todo) => ({
    id: todo.id ?? Date.now(),
    title: todo.title ?? "",
    done: todo.done ?? false,
    priority: todo.priority ?? "medium",
    duration: todo.duration ?? 60,
    dueDate: todo.dueDate ?? null,
    tags: todo.tags ?? [],
    recurrence: todo.recurrence ?? "none",
    subtasks: todo.subtasks ?? [],
  })).filter((todo) => todo.title.trim());
}

export function saveTodos(todos: Todo[]) {
  saveStoredArray(TODOS_KEY, todos);
}

export function loadHabits(): Habit[] {
  return parseStoredArray<Habit>(HABITS_KEY, (habit) => ({
    id: habit.id ?? Date.now(),
    name: habit.name ?? "",
    lastCompleted: habit.lastCompleted ?? null,
    streak: habit.streak ?? 0,
    category: habit.category ?? "personal",
    frequency: habit.frequency ?? "daily",
    targetType: habit.targetType ?? "binary",
    targetAmount: habit.targetAmount ?? 1,
    unit: habit.unit ?? "",
    preferredDays: habit.preferredDays ?? [],
    paused: habit.paused ?? false,
    timePreference: habit.timePreference ?? "anytime",
    notes: habit.notes ?? "",
    skipDays: habit.skipDays ?? [],
    completionHistory: habit.completionHistory ?? [],
  })).filter((habit) => habit.name.trim());
}

export function saveHabits(habits: Habit[]) {
  saveStoredArray(HABITS_KEY, habits);
}

export function loadJournals(): JournalEntry[] {
  return parseStoredArray<JournalEntry>(JOURNALS_KEY, (journal) => ({
    id: journal.id ?? Date.now(),
    date: journal.date ?? new Date().toISOString().split("T")[0],
    content: journal.content ?? "",
    title: journal.title ?? "",
    updatedAt: journal.updatedAt ?? journal.date ?? new Date().toISOString(),
    mood: journal.mood ?? "",
    energy: journal.energy ?? 3,
    themes: journal.themes ?? [],
    locked: journal.locked ?? false,
  })).filter((journal) => journal.content.trim());
}

export function saveJournals(journals: JournalEntry[]) {
  saveStoredArray(JOURNALS_KEY, journals);
}

export function loadPlans(): SavedPlan[] {
  return parseStoredArray<SavedPlan>(PLANS_KEY, (plan) => ({
    id: plan.id ?? Date.now(),
    title: plan.title ?? "",
    date: plan.date ?? new Date().toISOString().split("T")[0],
    startLabel: plan.startLabel ?? "8:00 AM",
    endLabel: plan.endLabel ?? "9:00 AM",
    recurrence: plan.recurrence ?? "none",
    category: plan.category ?? "other",
    priority: plan.priority ?? "medium",
    notes: plan.notes ?? "",
    customRecurrence: plan.customRecurrence ?? "",
    seriesId: plan.seriesId,
    excludedDates: plan.excludedDates ?? [],
  })).filter((plan) => plan.title.trim());
}

export function savePlans(plans: SavedPlan[]) {
  saveStoredArray(PLANS_KEY, plans);
}

export function loadChatMessages(): ChatMessage[] {
  return parseStoredArray<ChatMessage>(CHAT_MESSAGES_KEY, (message) => ({
    role: message.role === "user" ? "user" : "assistant",
    content: message.content ?? "",
    createdAt: message.createdAt ?? new Date().toISOString(),
  })).filter((message) => message.content.trim());
}

export function saveChatMessages(messages: ChatMessage[]) {
  saveStoredArray(CHAT_MESSAGES_KEY, messages.slice(-80));
}

export function loadCodingWorkflows(): CodingWorkflow[] {
  return parseStoredArray<CodingWorkflow>(CODING_WORKFLOWS_KEY, (workflow) => ({
    id: workflow.id ?? Date.now(),
    title: workflow.title ?? "",
    repo: workflow.repo ?? "",
    branchPrefix: workflow.branchPrefix ?? "ass/overnight",
    objective: workflow.objective ?? "",
    sourceContext: workflow.sourceContext ?? ["journal", "chat", "todos", "calendar", "habits"],
    guardrails: workflow.guardrails ?? [
      "Create a new branch for every coding run.",
      "Open a draft pull request with a summary, tests, and risks.",
      "Do not merge into main until Kevin performs final review.",
    ],
    status: workflow.status ?? "draft",
    createdAt: workflow.createdAt ?? new Date().toISOString(),
    generatedPrompt: workflow.generatedPrompt ?? "",
  })).filter((workflow) => workflow.title.trim() || workflow.objective.trim());
}

export function saveCodingWorkflows(workflows: CodingWorkflow[]) {
  saveStoredArray(CODING_WORKFLOWS_KEY, workflows);
}

export function loadProfileSettings(): ProfileSettings {
  if (typeof window === "undefined") {
    return defaultProfileSettings();
  }

  try {
    const parsed = JSON.parse(
      localStorage.getItem(PROFILE_KEY) ?? "{}"
    ) as Partial<ProfileSettings>;

    return {
      ...defaultProfileSettings(),
      ...parsed,
    };
  } catch {
    return defaultProfileSettings();
  }
}

export function saveProfileSettings(profile: ProfileSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function defaultProfileSettings(): ProfileSettings {
  return {
    displayName: "Kevin",
    primaryEmail: "",
    githubUsername: "",
    githubRepo: "",
    githubConnected: false,
    gmailConnected: false,
    outlookConnected: false,
  };
}
