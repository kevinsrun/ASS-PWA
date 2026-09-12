"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import {
  ChatMessage,
  CodingWorkflow,
  ProfileSettings,
  Todo,
  Habit,
  JournalEntry,
  SavedPlan,
} from "@/lib/types";
import {
  cloudSnapshotHasData,
  loadCloudSnapshot,
  saveCloudSnapshot,
} from "@/lib/supabaseData";
import { useAuth } from "@/providers/AuthProvider";
import {
  loadTodos,
  saveTodos,
  loadHabits,
  saveHabits,
  loadJournals,
  saveJournals,
  loadPlans,
  savePlans,
  loadChatMessages,
  saveChatMessages,
  loadCodingWorkflows,
  saveCodingWorkflows,
  loadProfileSettings,
  saveProfileSettings,
} from "@/lib/storage";

type AppContextType = {
  todos: Todo[];
  habits: Habit[];
  journals: JournalEntry[];
  addTodo: (
    title: string,
    priority?: "low" | "medium" | "high",
    duration?: number,
    dueDate?: string | null
  ) => void;
  toggleTodo: (id: number) => void;
  deleteTodo: (id: number) => void;
  addHabit: (name: string, details?: Partial<Omit<Habit, "id" | "name">>) => void;
  toggleHabit: (id: number) => void;
  deleteHabit: (id: number) => void;
  addJournal: (content: string, details?: Partial<Omit<JournalEntry, "id" | "content">>) => void;
  deleteJournal: (id: number) => void;
  updateJournal: (id: number, updates: Partial<Omit<JournalEntry, "id">>) => void;
  plans: SavedPlan[];
  chatMessages: ChatMessage[];
  codingWorkflows: CodingWorkflow[];
  profile: ProfileSettings;
  syncStatus: string;
  calendarActionError: string | null;
  reloadCloud: () => Promise<void>;
  addPlan: (plan: Omit<SavedPlan, "id">) => void;
  deletePlan: (id: number) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  addCodingWorkflow: (workflow: Omit<CodingWorkflow, "id" | "createdAt">) => void;
  updateCodingWorkflow: (id: number, updates: Partial<Omit<CodingWorkflow, "id">>) => void;
  deleteCodingWorkflow: (id: number) => void;
  updateProfile: (updates: Partial<ProfileSettings>) => void;
  updateTodo: (id: number, updates: Partial<Omit<Todo, "id">>) => void;
  updateHabit: (id: number, updates: Partial<Omit<Habit, "id">>) => void;
  updatePlan: (id: number, updates: Partial<Omit<SavedPlan, "id">>) => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { session, user } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [codingWorkflows, setCodingWorkflows] = useState<CodingWorkflow[]>([]);
  const [profile, setProfile] = useState<ProfileSettings>({
    displayName: "Kevin",
    primaryEmail: "",
    githubUsername: "",
    githubRepo: "",
    githubConnected: false,
    gmailConnected: false,
    outlookConnected: false,
  });
  const [hydrated, setHydrated] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local only");
  const [calendarActionError, setCalendarActionError] = useState<string | null>(null);

  useEffect(() => {
    setTodos(loadTodos());
    setHabits(loadHabits());
    setJournals(loadJournals());
    setPlans(loadPlans());
    setChatMessages(loadChatMessages());
    setCodingWorkflows(loadCodingWorkflows());
    setProfile(loadProfileSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      setCloudReady(false);
      setSyncStatus("Local only");
      return;
    }

    let cancelled = false;
    setSyncStatus("Checking cloud data...");

    loadCloudSnapshot(user.id)
      .then(async (cloud) => {
        if (cancelled) return;

        if (cloudSnapshotHasData(cloud)) {
          setTodos(cloud.todos);
          setHabits(cloud.habits);
          setJournals(cloud.journals);
          setPlans(cloud.plans);
          if (cloud.profile) setProfile(cloud.profile);
          setSyncStatus("Loaded from Supabase");
        } else {
          await saveCloudSnapshot(user.id, {
            todos,
            habits,
            journals,
            plans,
            profile,
          });
          setSyncStatus("Migrated local data to Supabase");
        }

        if (!cancelled) setCloudReady(true);
      })
      .catch((error) => {
        console.error("Supabase initial sync failed:", error);
        if (!cancelled) setSyncStatus("Cloud sync failed");
      });

    return () => {
      cancelled = true;
    };
  // Run once per authenticated user after local hydration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  useEffect(() => {
    saveHabits(habits);
  }, [habits]);

  useEffect(() => {
    saveJournals(journals);
  }, [journals]);

  useEffect(() => {
    savePlans(plans);
  }, [plans]);

  useEffect(() => {
    saveChatMessages(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    saveCodingWorkflows(codingWorkflows);
  }, [codingWorkflows]);

  useEffect(() => {
    saveProfileSettings(profile);
  }, [profile]);

  useEffect(() => {
    if (!user || !cloudReady) return;

    const timeout = window.setTimeout(() => {
      saveCloudSnapshot(user.id, {
        todos,
        habits,
        journals,
        plans,
        profile,
      })
        .then(() => setSyncStatus("Synced to Supabase"))
        .catch((error) => {
          console.error("Supabase save failed:", error);
          setSyncStatus("Cloud sync failed");
        });
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [cloudReady, habits, journals, plans, profile, todos, user]);

  function addTodo(
    title: string,
    priority: "low" | "medium" | "high" = "medium",
    duration: number = 60,
    dueDate: string | null = null
  ) {
    const trimmed = title.trim();
    if (!trimmed) return;

    setTodos((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: trimmed,
        done: false,
        priority,
        duration,
        dueDate,
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

  function addHabit(name: string, details: Partial<Omit<Habit, "id" | "name">> = {}) {
    const trimmed = name.trim();
    if (!trimmed) return;

    setHabits((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: trimmed,
        lastCompleted: null,
        streak: 0,
        category: details.category ?? "personal",
        frequency: details.frequency ?? "daily",
        timePreference: details.timePreference ?? "anytime",
        notes: details.notes ?? "",
        skipDays: details.skipDays ?? [],
        completionHistory: details.completionHistory ?? [],
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
          completionHistory: Array.from(
            new Set([...(habit.completionHistory ?? []), today])
          ),
        };
      })
    );
  }

  function deleteHabit(id: number) {
    setHabits((prev) => prev.filter((habit) => habit.id !== id));
  }

  function addJournal(content: string, details: Partial<Omit<JournalEntry, "id" | "content">> = {}) {
    const trimmed = content.trim();
    if (!trimmed) return;

    setJournals((prev) => [
      ...prev,
      {
        id: Date.now(),
        date: details.date ?? new Date().toISOString().split("T")[0],
        content: trimmed,
        mood: details.mood ?? "",
        energy: details.energy ?? 3,
        themes: details.themes ?? [],
        locked: details.locked ?? false,
      },
    ]);
  }

  function deleteJournal(id: number) {
    setJournals((prev) => prev.filter((journal) => journal.id !== id));
  }

  function updateJournal(id: number, updates: Partial<Omit<JournalEntry, "id">>) {
    setJournals((prev) =>
      prev.map((journal) =>
        journal.id === id ? { ...journal, ...updates } : journal
      )
    );
  }

  async function syncCalendarChange(
    method: "POST" | "PATCH" | "DELETE",
    plan: SavedPlan
  ) {
    if (!session?.access_token || !profile.gmailConnected) return;
    setCalendarActionError(null);
    try {
      const response = await fetch("/api/calendar/events", {
        method,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          method === "DELETE"
            ? {
                googleCalendarId: plan.googleCalendarId,
                googleEventId: plan.googleEventId,
              }
            : plan
        ),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Google Calendar could not be updated.");
      }
      await reloadCloud();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google Calendar could not be updated.";
      console.error("Google Calendar mutation failed:", message);
      setCalendarActionError(message);
    }
  }

  function addPlan(plan: Omit<SavedPlan, "id">) {
    const nextPlan = { id: Date.now(), ...plan };
    setPlans((prev) => [
      ...prev,
      nextPlan,
    ]);
    if (plan.source !== "google") {
      void syncCalendarChange("POST", nextPlan);
    }
  }

  function deletePlan(id: number) {
    const plan = plans.find((candidate) => candidate.id === id);
    setPlans((prev) => prev.filter((plan) => plan.id !== id));
    if (plan?.source === "google" && plan.googleCalendarId && plan.googleEventId) {
      void syncCalendarChange("DELETE", plan);
    }
  }

  function addCodingWorkflow(workflow: Omit<CodingWorkflow, "id" | "createdAt">) {
    setCodingWorkflows((prev) => [
      {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        ...workflow,
      },
      ...prev,
    ]);
  }

  function updateCodingWorkflow(
    id: number,
    updates: Partial<Omit<CodingWorkflow, "id">>
  ) {
    setCodingWorkflows((prev) =>
      prev.map((workflow) =>
        workflow.id === id ? { ...workflow, ...updates } : workflow
      )
    );
  }

  function deleteCodingWorkflow(id: number) {
    setCodingWorkflows((prev) =>
      prev.filter((workflow) => workflow.id !== id)
    );
  }

  function updateProfile(updates: Partial<ProfileSettings>) {
    setProfile((prev) => ({ ...prev, ...updates }));
  }

  function updateTodo(id: number, updates: Partial<Omit<Todo, "id">>) {
    setTodos((prev) =>
      prev.map((todo) => (todo.id === id ? { ...todo, ...updates } : todo))
    );
  }

  function updateHabit(id: number, updates: Partial<Omit<Habit, "id">>) {
    setHabits((prev) =>
      prev.map((habit) => (habit.id === id ? { ...habit, ...updates } : habit))
    );
  }

  function updatePlan(id: number, updates: Partial<Omit<SavedPlan, "id">>) {
    const plan = plans.find((candidate) => candidate.id === id);
    setPlans((prev) =>
      prev.map((plan) => (plan.id === id ? { ...plan, ...updates } : plan))
    );
    if (plan?.source === "google" && plan.googleCalendarId && plan.googleEventId) {
      void syncCalendarChange("PATCH", { ...plan, ...updates });
    }
  }

  const reloadCloud = useCallback(async () => {
    if (!user) return;
    setSyncStatus("Refreshing cloud data...");
    try {
      const cloud = await loadCloudSnapshot(user.id);
      setTodos(cloud.todos);
      setHabits(cloud.habits);
      setJournals(cloud.journals);
      setPlans(cloud.plans);
      if (cloud.profile) setProfile(cloud.profile);
      setSyncStatus("Synced to Supabase");
    } catch (error) {
      console.error("Supabase refresh failed:", error);
      setSyncStatus("Cloud sync failed");
      throw error;
    }
  }, [user]);

  const value = {
      todos,
      habits,
      journals,
      addTodo,
      toggleTodo,
      deleteTodo,
      addHabit,
      toggleHabit,
      deleteHabit,
      addJournal,
      deleteJournal,
      updateJournal,
      plans,
      chatMessages,
      codingWorkflows,
      profile,
      syncStatus,
      calendarActionError,
      reloadCloud,
      addPlan,
      deletePlan,
      setChatMessages,
      addCodingWorkflow,
      updateCodingWorkflow,
      deleteCodingWorkflow,
      updateProfile,
      updateTodo,
      updateHabit,
      updatePlan,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppContext must be used inside AppProvider");
  }

  return context;
}
