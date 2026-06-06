"use client";

import { getBrowserSupabaseClient } from "@/lib/supabaseBrowser";
import {
  Habit,
  JournalEntry,
  ProfileSettings,
  SavedPlan,
  Todo,
} from "@/lib/types";

export type CloudSnapshot = {
  todos: Todo[];
  habits: Habit[];
  journals: JournalEntry[];
  plans: SavedPlan[];
  profile: ProfileSettings | null;
};

export type LocalSnapshot = {
  todos: Todo[];
  habits: Habit[];
  journals: JournalEntry[];
  plans: SavedPlan[];
  profile: ProfileSettings;
};

type ProfileRow = {
  display_name?: string | null;
  primary_email?: string | null;
  github_username?: string | null;
  github_repo?: string | null;
  github_connected?: boolean | null;
  gmail_connected?: boolean | null;
  outlook_connected?: boolean | null;
};

type TodoRow = {
  local_id?: number | string | null;
  title?: string | null;
  done?: boolean | null;
  priority?: "low" | "medium" | "high" | null;
  duration?: number | string | null;
  due_date?: string | null;
  tags?: string[] | null;
  recurrence?: Todo["recurrence"] | null;
  subtasks?: Todo["subtasks"] | null;
};

type HabitRow = {
  local_id?: number | string | null;
  name?: string | null;
  last_completed?: string | null;
  streak?: number | string | null;
  category?: Habit["category"] | null;
  frequency?: Habit["frequency"] | null;
  time_preference?: Habit["timePreference"] | null;
  notes?: string | null;
  skip_days?: string[] | null;
  completion_history?: string[] | null;
};

type JournalRow = {
  local_id?: number | string | null;
  date?: string | null;
  content?: string | null;
  mood?: string | null;
  energy?: number | string | null;
  themes?: string[] | null;
  locked?: boolean | null;
};

type PlanRow = {
  local_id?: number | string | null;
  title?: string | null;
  date?: string | null;
  start_label?: string | null;
  end_label?: string | null;
  recurrence?: SavedPlan["recurrence"] | null;
  category?: SavedPlan["category"] | null;
  priority?: SavedPlan["priority"] | null;
  notes?: string | null;
  custom_recurrence?: string | null;
  series_id?: string | null;
  excluded_dates?: string[] | null;
};

function hasCoreData(snapshot: CloudSnapshot) {
  return (
    snapshot.todos.length > 0 ||
    snapshot.habits.length > 0 ||
    snapshot.journals.length > 0 ||
    snapshot.plans.length > 0 ||
    snapshot.profile !== null
  );
}

export function cloudSnapshotHasData(snapshot: CloudSnapshot) {
  return hasCoreData(snapshot);
}

export async function loadCloudSnapshot(userId: string): Promise<CloudSnapshot> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return { todos: [], habits: [], journals: [], plans: [], profile: null };
  }

  const [profile, todos, habits, journals, plans] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("todos").select("*").eq("user_id", userId).order("local_id"),
    supabase.from("habits").select("*").eq("user_id", userId).order("local_id"),
    supabase
      .from("journal_entries")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false }),
    supabase.from("plans").select("*").eq("user_id", userId).order("date"),
  ]);
  const profileRow = profile.data as ProfileRow | null;
  const todoRows = (todos.data ?? []) as TodoRow[];
  const habitRows = (habits.data ?? []) as HabitRow[];
  const journalRows = (journals.data ?? []) as JournalRow[];
  const planRows = (plans.data ?? []) as PlanRow[];

  return {
    profile: profileRow
      ? {
          displayName: profileRow.display_name ?? "Kevin",
          primaryEmail: profileRow.primary_email ?? "",
          githubUsername: profileRow.github_username ?? "",
          githubRepo: profileRow.github_repo ?? "",
          githubConnected: Boolean(profileRow.github_connected),
          gmailConnected: Boolean(profileRow.gmail_connected),
          outlookConnected: Boolean(profileRow.outlook_connected),
        }
      : null,
    todos: todoRows.map((todo) => ({
        id: Number(todo.local_id),
        title: todo.title ?? "",
        done: Boolean(todo.done),
        priority: todo.priority ?? "medium",
        duration: Number(todo.duration ?? 60),
        dueDate: todo.due_date ?? null,
        tags: todo.tags ?? [],
        recurrence: todo.recurrence ?? "none",
        subtasks: todo.subtasks ?? [],
      })),
    habits: habitRows.map((habit) => ({
        id: Number(habit.local_id),
        name: habit.name ?? "",
        lastCompleted: habit.last_completed ?? null,
        streak: Number(habit.streak ?? 0),
        category: habit.category ?? "personal",
        frequency: habit.frequency ?? "daily",
        timePreference: habit.time_preference ?? "anytime",
        notes: habit.notes ?? "",
        skipDays: habit.skip_days ?? [],
        completionHistory: habit.completion_history ?? [],
      })),
    journals: journalRows.map((journal) => ({
        id: Number(journal.local_id),
        date: journal.date ?? new Date().toISOString().split("T")[0],
        content: journal.content ?? "",
        mood: journal.mood ?? "",
        energy: Number(journal.energy ?? 3),
        themes: journal.themes ?? [],
        locked: Boolean(journal.locked),
      })),
    plans: planRows.map((plan) => ({
        id: Number(plan.local_id),
        title: plan.title ?? "",
        date: plan.date ?? new Date().toISOString().split("T")[0],
        startLabel: plan.start_label ?? "9:00 AM",
        endLabel: plan.end_label ?? "10:00 AM",
        recurrence: plan.recurrence ?? "none",
        category: plan.category ?? "other",
        priority: plan.priority ?? "medium",
        notes: plan.notes ?? "",
        customRecurrence: plan.custom_recurrence ?? "",
        seriesId: plan.series_id ?? undefined,
        excludedDates: plan.excluded_dates ?? [],
      })),
  };
}

export async function saveCloudSnapshot(userId: string, snapshot: LocalSnapshot) {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  await supabase.from("profiles").upsert({
    user_id: userId,
    display_name: snapshot.profile.displayName,
    primary_email: snapshot.profile.primaryEmail,
    github_username: snapshot.profile.githubUsername,
    github_repo: snapshot.profile.githubRepo,
    github_connected: snapshot.profile.githubConnected,
    gmail_connected: snapshot.profile.gmailConnected,
    outlook_connected: snapshot.profile.outlookConnected,
    updated_at: new Date().toISOString(),
  });

  await Promise.all([
    replaceRows(userId, "todos", snapshot.todos.map(todoToRow)),
    replaceRows(userId, "habits", snapshot.habits.map(habitToRow)),
    replaceRows(userId, "journal_entries", snapshot.journals.map(journalToRow)),
    replaceRows(userId, "plans", snapshot.plans.map(planToRow)),
  ]);
}

async function replaceRows(
  userId: string,
  table: "todos" | "habits" | "journal_entries" | "plans",
  rows: Array<Record<string, unknown>>
) {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) return;

  await supabase.from(table).delete().eq("user_id", userId);
  if (rows.length === 0) return;

  await supabase.from(table).insert(
    rows.map((row) => ({
      ...row,
      user_id: userId,
      updated_at: new Date().toISOString(),
    }))
  );
}

function todoToRow(todo: Todo) {
  return {
    local_id: todo.id,
    title: todo.title,
    done: todo.done,
    priority: todo.priority,
    duration: todo.duration,
    due_date: todo.dueDate,
    tags: todo.tags ?? [],
    recurrence: todo.recurrence ?? "none",
    subtasks: todo.subtasks ?? [],
  };
}

function habitToRow(habit: Habit) {
  return {
    local_id: habit.id,
    name: habit.name,
    last_completed: habit.lastCompleted,
    streak: habit.streak,
    category: habit.category ?? "personal",
    frequency: habit.frequency ?? "daily",
    time_preference: habit.timePreference ?? "anytime",
    notes: habit.notes ?? "",
    skip_days: habit.skipDays ?? [],
    completion_history: habit.completionHistory ?? [],
  };
}

function journalToRow(journal: JournalEntry) {
  return {
    local_id: journal.id,
    date: journal.date,
    content: journal.content,
    mood: journal.mood ?? "",
    energy: journal.energy ?? 3,
    themes: journal.themes ?? [],
    locked: journal.locked ?? false,
  };
}

function planToRow(plan: SavedPlan) {
  return {
    local_id: plan.id,
    title: plan.title,
    date: plan.date,
    start_label: plan.startLabel,
    end_label: plan.endLabel,
    recurrence: plan.recurrence,
    category: plan.category ?? "other",
    priority: plan.priority ?? "medium",
    notes: plan.notes ?? "",
    custom_recurrence: plan.customRecurrence ?? "",
    series_id: plan.seriesId ?? null,
    excluded_dates: plan.excludedDates ?? [],
  };
}
