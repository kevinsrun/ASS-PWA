"use client";

import { useEffect, useState } from "react";
import { addMinutesToLabel, formatTimeLabel, getTodayString } from "@/lib/dateTime";
import { JournalSuggestion } from "@/lib/types";
import { useAppContext } from "@/providers/AppProvider";

const MOODS = [
  { value: "steady", label: "Steady", color: "bg-emerald-100 text-emerald-800" },
  { value: "focused", label: "Focused", color: "bg-blue-100 text-blue-800" },
  { value: "tired", label: "Tired", color: "bg-amber-100 text-amber-800" },
  { value: "stressed", label: "Stressed", color: "bg-rose-100 text-rose-800" },
  { value: "excited", label: "Excited", color: "bg-cyan-100 text-cyan-800" },
];

type InterpreterTodo = {
  title?: string;
  priority?: JournalSuggestion["priority"];
  mood?: string;
  stress?: JournalSuggestion["stress"];
  deadline?: string | null;
  intention?: string | null;
};

type InterpreterHabit = {
  title?: string;
  recurrence?: JournalSuggestion["recurrence"];
  mood?: string;
  stress?: JournalSuggestion["stress"];
  intention?: string | null;
};

type InterpreterPlan = {
  title?: string;
  time?: string | null;
  duration?: number;
  recurrence?: JournalSuggestion["recurrence"];
  priority?: JournalSuggestion["priority"];
  notes?: string;
  mood?: string;
  stress?: JournalSuggestion["stress"];
  deadline?: string | null;
  intention?: string | null;
};

type InterpreterResponse = {
  todos?: InterpreterTodo[];
  habits?: InterpreterHabit[];
  plans?: InterpreterPlan[];
};

function toTitleCase(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeTitle(title: string | undefined) {
  return title ? toTitleCase(title.trim()) : "";
}

function buildSuggestions(data: InterpreterResponse): JournalSuggestion[] {
  const todos =
    data.todos?.map((todo) => ({
      type: "todo" as const,
      title: normalizeTitle(todo.title),
      priority: todo.priority ?? "medium",
      mood: todo.mood,
      stress: todo.stress,
      deadline: todo.deadline,
      intention: todo.intention,
    })) ?? [];

  const habits =
    data.habits?.map((habit) => ({
      type: "habit" as const,
      title: normalizeTitle(habit.title),
      recurrence: habit.recurrence,
      mood: habit.mood,
      stress: habit.stress,
      intention: habit.intention,
    })) ?? [];

  const plans =
    data.plans?.map((plan) => ({
      type: "plan" as const,
      title: normalizeTitle(plan.title),
      time: plan.time,
      duration: plan.duration ?? 60,
      recurrence: plan.recurrence ?? "none",
      priority: plan.priority ?? "medium",
      notes: plan.notes,
      mood: plan.mood,
      stress: plan.stress,
      deadline: plan.deadline,
      intention: plan.intention,
    })) ?? [];

  return [...todos, ...habits, ...plans].filter((suggestion) =>
    suggestion.title.trim()
  );
}

async function interpretJournal(text: string) {
  const response = await fetch("/api/interpret-journal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ journal: text }),
  });

  if (!response.ok) {
    throw new Error("Journal interpretation failed");
  }

  return buildSuggestions((await response.json()) as InterpreterResponse);
}

export default function JournalPage() {
  const {
    journals,
    addJournal,
    deleteJournal,
    updateJournal,
    addTodo,
    addHabit,
    addPlan,
  } = useAppContext();
  const [entry, setEntry] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState(3);
  const [themes, setThemes] = useState("");
  const [lockedDraft, setLockedDraft] = useState(false);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalUnlocked, setJournalUnlocked] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [suggestions, setSuggestions] = useState<JournalSuggestion[]>([]);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [lastInterpretedText, setLastInterpretedText] = useState("");
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [cachedSuggestions, setCachedSuggestions] = useState<
    Record<string, JournalSuggestion[]>
  >({});

  useEffect(() => {
    const savedDraft = localStorage.getItem("ass_journal_draft");
    if (savedDraft) setEntry(savedDraft);
  }, []);

  useEffect(() => {
    localStorage.setItem("ass_journal_draft", entry);
  }, [entry]);

  useEffect(() => {
    const text = entry.trim();
    if (text.length < 40 || text === lastInterpretedText) return;

    const wordDelta = Math.abs(
      text.split(/\s+/).length - lastInterpretedText.split(/\s+/).length
    );
    if (wordDelta < 8) return;

    const shouldInterpret =
      text.endsWith(".") ||
      text.endsWith("?") ||
      text.endsWith("!") ||
      text.includes("\n\n");
    if (!shouldInterpret || Date.now() - lastRequestTime < 45000) return;

    const cached = cachedSuggestions[text];
    if (cached) {
      setSuggestions(cached);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsInterpreting(true);

      try {
        const newSuggestions = await interpretJournal(text);
        setSuggestions(newSuggestions);
        setCachedSuggestions((prev) => ({
          ...prev,
          [text]: newSuggestions,
        }));
        setLastInterpretedText(text);
        setLastRequestTime(Date.now());
      } catch (error) {
        console.error("Auto-interpret failed:", error);
      } finally {
        setIsInterpreting(false);
      }
    }, 20000);

    return () => window.clearTimeout(timer);
  }, [cachedSuggestions, entry, lastInterpretedText, lastRequestTime]);

  async function saveEntry() {
    const text = entry.trim();
    if (!text) return;

    addJournal(text, {
      mood,
      energy,
      themes: themes
        .split(",")
        .map((theme) => theme.trim())
        .filter(Boolean),
      locked: lockedDraft,
    });

    try {
      setIsInterpreting(true);
      const newSuggestions = await interpretJournal(text);
      setSuggestions(newSuggestions);
      setLastInterpretedText(text);
      setEntry("");
      setMood("");
      setEnergy(3);
      setThemes("");
      setLockedDraft(false);
      localStorage.removeItem("ass_journal_draft");
    } catch (error) {
      console.error("Save interpret failed:", error);
    } finally {
      setIsInterpreting(false);
    }
  }

  async function suggestFromJournal() {
    const text = entry.trim();
    if (!text) return;

    try {
      setIsInterpreting(true);
      const newSuggestions = await interpretJournal(text);
      setSuggestions(newSuggestions);
      setLastInterpretedText(text);
    } catch (error) {
      console.error("Manual suggest failed:", error);
    } finally {
      setIsInterpreting(false);
    }
  }

  function emailJournal() {
    const subject = encodeURIComponent("Daily Journal Entry");
    const body = encodeURIComponent(entry);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  const visibleJournals = journals.filter((journal) => {
    if (journal.locked && !journalUnlocked) return false;
    const query = journalSearch.toLowerCase().trim();
    if (!query) return true;

    return (
      journal.content.toLowerCase().includes(query) ||
      journal.date.includes(query) ||
      (journal.mood ?? "").toLowerCase().includes(query) ||
      (journal.themes ?? []).some((theme) => theme.toLowerCase().includes(query))
    );
  });

  function applySuggestion(suggestion: JournalSuggestion) {
    if (suggestion.type === "todo") {
      addTodo(
        suggestion.title,
        suggestion.priority ?? "medium",
        60,
        suggestion.deadline ?? null
      );
    }

    if (suggestion.type === "habit") {
      addHabit(suggestion.title);
    }

    if (suggestion.type === "plan") {
      const startTime = suggestion.time ?? "08:00";
      const duration = suggestion.duration ?? 60;

      addPlan({
        title: suggestion.title,
        date: getTodayString(),
        startLabel: formatTimeLabel(startTime),
        endLabel: addMinutesToLabel(startTime, duration),
        recurrence: suggestion.recurrence ?? "none",
        category: "personal",
        priority: suggestion.priority ?? "medium",
        notes: suggestion.notes ?? suggestion.intention ?? "",
      });

      if (suggestion.recurrence === "daily") {
        addHabit(suggestion.title);
      }

      if (suggestion.recurrence === "none") {
        addTodo(suggestion.title, suggestion.priority ?? "medium", duration, null);
      }
    }
  }

  function addSuggestion(suggestion: JournalSuggestion, index: number) {
    applySuggestion(suggestion);
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
  }

  function addAllSuggestions() {
    suggestions.forEach(applySuggestion);
    setSuggestions([]);
  }

  return (
    <div className="min-h-screen">
      <main className="journal-page mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1>Journal</h1>

        <textarea
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          placeholder="Start writing…"
          className="journal-sheet mt-6 min-h-[52vh] w-full p-1 outline-none"
        />

        <div className="ios-card mt-3 rounded-3xl p-4">
          <div className="text-sm font-semibold text-emerald-950">Emotion</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {MOODS.map((option) => (
              <button
                key={option.value}
                onClick={() => setMood(option.value)}
                className={`min-h-11 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  mood === option.value
                    ? option.color
                    : "bg-slate-100 text-slate-600 hover:bg-emerald-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-emerald-950">Energy</div>
            <div className="text-xs text-slate-500">
              {energy <= 2 ? "Low" : energy === 3 ? "Medium" : "High"}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                onClick={() => setEnergy(value)}
                className={`h-5 rounded-full transition ${
                  value <= energy
                    ? value < 3
                      ? "bg-amber-400"
                      : value === 3
                      ? "bg-blue-400"
                      : "bg-emerald-500"
                    : "bg-slate-100"
                }`}
                aria-label={`Set energy level ${value}`}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={themes}
            onChange={(event) => setThemes(event.target.value)}
            placeholder="Themes, comma separated"
            className="min-h-12 rounded-xl border border-emerald-100 bg-white/90 px-3 py-2"
          />
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-emerald-100 bg-white/90 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={lockedDraft}
              onChange={(event) => setLockedDraft(event.target.checked)}
            />
            Locked
          </label>
        </div>

        <div className="mt-2 text-sm text-gray-500">
          {isInterpreting
            ? "AI is reading your journal..."
            : "AI will suggest tasks after a quiet writing pause."}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={saveEntry}
            className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-white hover:bg-emerald-700"
          >
            Save Journal
          </button>

          <button
            onClick={suggestFromJournal}
            className="min-h-12 rounded-xl border px-4 py-3"
          >
            Suggest Now
          </button>

          <button onClick={emailJournal} className="min-h-12 rounded-xl border px-4 py-3">
            Email Entry
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">AI Suggestions</h2>
              <div className="flex gap-2">
                <button
                  onClick={addAllSuggestions}
                  className="min-h-11 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white"
                >
                  Add All
                </button>
                <button
                  onClick={() => setSuggestions([])}
                  className="min-h-11 rounded-lg border px-3 py-2 text-sm"
                >
                  Reject
                </button>
              </div>
            </div>

            {suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.type}-${suggestion.title}-${index}`}
                className="ios-card flex flex-col justify-between gap-4 rounded-2xl p-4 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="font-medium">{suggestion.title}</div>
                  <div className="text-sm text-gray-500 capitalize">
                    Suggested {suggestion.type}
                    {suggestion.type === "plan" && suggestion.time
                      ? ` - ${formatTimeLabel(suggestion.time)}`
                      : ""}
                    {suggestion.recurrence ? ` - ${suggestion.recurrence}` : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                    {suggestion.priority && <span>{suggestion.priority}</span>}
                    {suggestion.stress && <span>stress: {suggestion.stress}</span>}
                    {suggestion.mood && <span>mood: {suggestion.mood}</span>}
                    {suggestion.deadline && <span>due: {suggestion.deadline}</span>}
                    {suggestion.intention && <span>{suggestion.intention}</span>}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => addSuggestion(suggestion, index)}
                    className="min-h-11 rounded-lg border px-3 py-2 text-sm"
                  >
                    Add
                  </button>
                  <button
                    onClick={() =>
                      setSuggestions((prev) => prev.filter((_, i) => i !== index))
                    }
                    className="min-h-11 rounded-lg border px-3 py-2 text-sm text-red-600"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          <input
            value={journalSearch}
            onChange={(event) => setJournalSearch(event.target.value)}
            placeholder="Search journal history..."
            className="min-h-12 flex-1 rounded-xl border px-4 py-3"
          />
          <button
            onClick={() => setJournalUnlocked((prev) => !prev)}
            className="min-h-12 rounded-xl border px-4 py-3"
          >
            {journalUnlocked ? "Lock Private" : "Unlock Private"}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {visibleJournals.map((journal) => (
            <div key={journal.id} className="ios-card rounded-2xl p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm text-gray-500">
                    {journal.date}
                    {journal.locked ? " / locked" : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                    {journal.mood && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                        {journal.mood}
                      </span>
                    )}
                    {journal.energy && (
                      <span className="inline-flex items-center gap-1">
                        <span>Energy</span>
                        <span className="inline-grid grid-cols-5 gap-0.5">
                          {[1, 2, 3, 4, 5].map((value) => (
                            <span
                              key={value}
                              className={`h-1.5 w-3 rounded-full ${
                                value <= (journal.energy ?? 0)
                                  ? "bg-emerald-500"
                                  : "bg-slate-200"
                              }`}
                            />
                          ))}
                        </span>
                      </span>
                    )}
                    {(journal.themes ?? []).map((theme) => (
                      <span
                        key={theme}
                        className="rounded-full bg-slate-100 px-2 py-0.5"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingJournalId(journal.id);
                      setEditingContent(journal.content);
                    }}
                    className="min-h-10 rounded-lg border px-3 py-1 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteJournal(journal.id)}
                    className="min-h-10 rounded-lg border px-3 py-1 text-sm text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {editingJournalId === journal.id ? (
                <div className="mt-3">
                  <textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    className="min-h-32 w-full rounded-xl border p-3"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        updateJournal(journal.id, { content: editingContent });
                        setEditingJournalId(null);
                      }}
                      className="min-h-11 rounded-lg bg-gray-900 px-3 py-2 text-white"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingJournalId(null)}
                      className="min-h-11 rounded-lg border px-3 py-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap">{journal.content}</p>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
