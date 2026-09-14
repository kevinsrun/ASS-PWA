"use client";

import {
  DragEvent,
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mail,
  Plus,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  addMinutesToLabel,
  clockToMinutes,
  formatTimeLabel,
  getTodayString,
  labelToMinutes,
  minutesToClock,
} from "@/lib/dateTime";
import { EmailCalendarSuggestion } from "@/lib/emailParser";
import {
  PlanCategory,
  PlanPriority,
  PlanRecurrence,
  SavedPlan,
} from "@/lib/types";
import { getIncompleteTodos, getPendingHabits } from "@/lib/planner";
import { getUsFederalHolidaysForDates } from "@/lib/holidays";
import { buildLearningProfile } from "@/lib/learning";
import { useAppContext } from "@/providers/AppProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useCalendarSync } from "@/hooks/useCalendarSync";
import { recurrenceMatchesDate } from "@/lib/academicSchedule";
import CalendarSyncIndicator from "@/components/CalendarSyncIndicator";

type OptimizerSuggestion = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  category: PlanCategory;
  priority: PlanPriority;
  notes: string;
};

const DAY_START = 0;
const DAY_END = 24 * 60;
const DAY_MINUTES = DAY_END - DAY_START;
const PX_PER_MINUTE = 1.05;
const MIN_EVENT_HEIGHT = 30;
const UNSCHEDULED_TARGET = 0.2;

const CATEGORIES: Record<
  PlanCategory,
  { label: string; block: string; chip: string; dot: string; ring: string }
> = {
  school: {
    label: "School",
    block: "border-blue-500 bg-blue-50 text-blue-950",
    chip: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
    ring: "ring-blue-200",
  },
  fitness: {
    label: "Fitness",
    block: "border-emerald-500 bg-emerald-50 text-emerald-950",
    chip: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
    ring: "ring-emerald-200",
  },
  work: {
    label: "Work",
    block: "border-violet-500 bg-violet-50 text-violet-950",
    chip: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
    ring: "ring-violet-200",
  },
  health: {
    label: "Health",
    block: "border-rose-500 bg-rose-50 text-rose-950",
    chip: "bg-rose-100 text-rose-700",
    dot: "bg-rose-500",
    ring: "ring-rose-200",
  },
  personal: {
    label: "Personal",
    block: "border-cyan-500 bg-cyan-50 text-cyan-950",
    chip: "bg-cyan-100 text-cyan-700",
    dot: "bg-cyan-500",
    ring: "ring-cyan-200",
  },
  finance: {
    label: "Finance",
    block: "border-amber-500 bg-amber-50 text-amber-950",
    chip: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
    ring: "ring-amber-200",
  },
  other: {
    label: "Other",
    block: "border-slate-400 bg-slate-50 text-slate-900",
    chip: "bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
    ring: "ring-slate-200",
  },
};

const RECURRENCE_OPTIONS: Array<{ value: PlanRecurrence; label: string }> = [
  { value: "none", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom" },
];

function formatDateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStart(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function formatHour(hour: number) {
  if (hour === 24) return "12 AM";
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function planRange(plan: Pick<SavedPlan, "startLabel" | "endLabel">) {
  return {
    start: labelToMinutes(plan.startLabel),
    end: labelToMinutes(plan.endLabel),
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function isPlanVisibleOnDate(plan: SavedPlan, dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  const planDate = new Date(`${plan.date}T00:00:00`);
  const custom = (plan.customRecurrence ?? "").toLowerCase();

  if (plan.excludedDates?.includes(dateKey)) return false;
  if (plan.date === dateKey) return true;
  if (plan.date > dateKey) return false;
  if (plan.recurrence === "daily") return true;
  if (plan.recurrence === "weekdays") return date.getDay() > 0 && date.getDay() < 6;
  if (plan.recurrence === "weekends") return date.getDay() === 0 || date.getDay() === 6;
  if (plan.recurrence === "weekly") return planDate.getDay() === date.getDay();
  if (plan.recurrence === "custom") {
    if (/RRULE:/i.test(custom) && recurrenceMatchesDate(custom, date)) return true;
    const daysSinceStart = Math.floor(
      (date.getTime() - planDate.getTime()) / 86_400_000
    );
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const selectedDays = dayNames
      .map((dayName, index) => ({ dayName, index }))
      .filter(({ dayName }) => custom.includes(dayName));
    const intervalMatch = custom.match(/every\s+(\d+)\s+days?/);

    if (custom.includes("every other day") || custom.includes("every 2 days")) {
      return daysSinceStart % 2 === 0;
    }

    if (intervalMatch) {
      const interval = Number(intervalMatch[1]);
      return interval > 0 && daysSinceStart % interval === 0;
    }

    if (selectedDays.length > 0) {
      return selectedDays.some(({ index }) => index === date.getDay());
    }
  }

  return false;
}

function getVisiblePlans(plans: SavedPlan[], dateKey: string) {
  return plans
    .filter((plan) => isPlanVisibleOnDate(plan, dateKey))
    .sort((a, b) => planRange(a).start - planRange(b).start);
}

function getConflicts(plans: SavedPlan[], dateKey: string) {
  const visible = getVisiblePlans(plans, dateKey).filter((plan) => !plan.allDay);
  const conflicts: Array<{ a: SavedPlan; b: SavedPlan }> = [];

  visible.forEach((plan, index) => {
    const a = planRange(plan);
    visible.slice(index + 1).forEach((candidate) => {
      const b = planRange(candidate);
      if (rangesOverlap(a.start, a.end, b.start, b.end)) {
        conflicts.push({ a: plan, b: candidate });
      }
    });
  });

  return conflicts;
}

function scheduledMinutes(plans: SavedPlan[]) {
  return plans.reduce((total, plan) => {
    const { start, end } = planRange(plan);
    return total + Math.max(0, end - start);
  }, 0);
}

function findOpenSlots(
  plans: SavedPlan[],
  duration: number,
  limit = 3,
  reserveTwentyPercent = true
) {
  const sorted = [...plans]
    .map(planRange)
    .sort((a, b) => a.start - b.start);
  const slots: Array<{ start: number; end: number }> = [];
  let cursor = DAY_START;
  const maxScheduled = DAY_MINUTES * (1 - UNSCHEDULED_TARGET);
  const used = scheduledMinutes(plans);

  if (reserveTwentyPercent && used + duration > maxScheduled) {
    return [];
  }

  sorted.forEach((range) => {
    if (range.start - cursor >= duration) {
      slots.push({ start: cursor, end: cursor + duration });
    }
    cursor = Math.max(cursor, range.end + 15);
  });

  if (DAY_END - cursor >= duration) {
    slots.push({ start: cursor, end: cursor + duration });
  }

  return slots.slice(0, limit);
}

function getOpenGaps(plans: SavedPlan[], minimumGap = 30) {
  const sorted = [...plans]
    .map(planRange)
    .sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = DAY_START;

  sorted.forEach((range) => {
    if (range.start - cursor >= minimumGap) {
      gaps.push({ start: cursor, end: range.start });
    }

    cursor = Math.max(cursor, range.end);
  });

  if (DAY_END - cursor >= minimumGap) {
    gaps.push({ start: cursor, end: DAY_END });
  }

  return gaps;
}

function eventStyle(plan: SavedPlan, conflictCount: number) {
  const { start, end } = planRange(plan);
  const width = conflictCount > 0 ? "calc(100% - 1.5rem)" : "calc(100% - 0.75rem)";

  return {
    top: `${Math.max(0, (start - DAY_START) * PX_PER_MINUTE)}px`,
    height: `${Math.max(MIN_EVENT_HEIGHT, (end - start) * PX_PER_MINUTE)}px`,
    width,
  };
}

function dateLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function CalendarPage() {
  const {
    todos,
    habits,
    plans,
    journals,
    addPlan,
    deletePlan,
    updatePlan,
    toggleHabit,
    reloadCloud,
    calendarActionError,
  } = useAppContext();
  const { session } = useAuth();
  const calendarSync = useCalendarSync(reloadCloud);
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(getTodayString());
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [recurrence, setRecurrence] = useState<PlanRecurrence>("none");
  const [customRecurrence, setCustomRecurrence] = useState("");
  const [category, setCategory] = useState<PlanCategory>("personal");
  const [priority, setPriority] = useState<PlanPriority>("medium");
  const [notes, setNotes] = useState("");
  const [builderMessage, setBuilderMessage] = useState("");
  const [emailText, setEmailText] = useState("");
  const [gmailSuggestions, setGmailSuggestions] = useState<EmailCalendarSuggestion[]>([]);
  const [isScanningGmail, setIsScanningGmail] = useState(false);
  const [emailImportStatus, setEmailImportStatus] = useState(
    "Connect Gmail, scan recent messages, or paste an email into a calendar block."
  );

  async function handleDeletePlan(plan: SavedPlan) {
    const deleteFromGoogle = Boolean(plan.googleEventId)
      ? window.confirm(`Delete “${plan.title}” from Google Calendar too?\n\nOK deletes it everywhere. Cancel hides it only in ASS.`)
      : false;
    const result = await deletePlan(plan.id, { deleteFromGoogle });
    if (!result.ok) setBuilderMessage(result.error ?? "The event could not be deleted.");
  }
  const [optimizerSuggestions, setOptimizerSuggestions] = useState<
    OptimizerSuggestion[]
  >([]);
  const [activePanel, setActivePanel] = useState<
    "none" | "build" | "habits" | "insights" | "email"
  >("none");
  const [calendarView, setCalendarView] = useState<"month" | "week" | "day">("week");
  const [monthPopoverDate, setMonthPopoverDate] = useState<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const didInitialScroll = useRef(false);
  const [visibleHourRange, setVisibleHourRange] = useState({ start: 0, end: 12 });

  const today = getTodayString();
  const weekStart = getWeekStart(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    return {
      date: day,
      key: formatDateKey(day),
      label: day.toLocaleDateString("en-US", { weekday: "short" }),
      dayNumber: day.getDate(),
    };
  });
  const calendarDays =
    calendarView === "day"
      ? weekDays.filter((day) => day.key === selectedDate)
      : weekDays;
  const desktopGridColumns = `72px repeat(${calendarDays.length}, minmax(180px, 1fr))`;
  const monthStart = new Date(
    new Date(`${selectedDate}T00:00:00`).getFullYear(),
    new Date(`${selectedDate}T00:00:00`).getMonth(),
    1
  );
  const miniCalendarStart = addDays(monthStart, -monthStart.getDay());
  const miniCalendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = addDays(miniCalendarStart, index);
    return {
      key: formatDateKey(day),
      number: day.getDate(),
      currentMonth: day.getMonth() === monthStart.getMonth(),
    };
  });
  const monthDays = miniCalendarDays.map((day) => ({
    ...day,
    plans: getVisiblePlans(plans, day.key),
  }));
  const hours = Array.from(
    { length: (DAY_END - DAY_START) / 60 + 1 },
    (_, index) => DAY_START / 60 + index
  );
  const timelineHeight = DAY_MINUTES * PX_PER_MINUTE;
  const incompleteTodos = getIncompleteTodos(todos);
  const pendingHabits = getPendingHabits(habits);
  const learning = buildLearningProfile({ todos, habits, journals, plans });
  const selectedDayPlans = useMemo(
    () => getVisiblePlans(plans, selectedDate).filter((plan) => !plan.allDay),
    [plans, selectedDate]
  );
  const selectedOpenGaps = useMemo(
    () => getOpenGaps(selectedDayPlans, 30),
    [selectedDayPlans]
  );
  const weekHolidays = useMemo(
    () => getUsFederalHolidaysForDates(weekDays.map((day) => day.key)),
    [weekDays]
  );
  const selectedHolidays = weekHolidays.filter(
    (holiday) => holiday.date === selectedDate
  );
  const selectedConflicts = getConflicts(plans, selectedDate);
  const selectedScheduledMinutes = scheduledMinutes(selectedDayPlans);
  const selectedImpossible = selectedScheduledMinutes > DAY_MINUTES * (1 - UNSCHEDULED_TARGET);
  const builderDuration = Math.max(0, clockToMinutes(endTime) - clockToMinutes(startTime));
  const builderConflicts = selectedDayPlans.filter((plan) => {
    if (plan.id < 0) return false;
    const range = planRange(plan);
    return rangesOverlap(
      clockToMinutes(startTime),
      clockToMinutes(endTime),
      range.start,
      range.end
    );
  });
  const alternateSlots = findOpenSlots(selectedDayPlans, Math.max(15, builderDuration || 60));
  const dailyBriefing = {
    overdue: todos.filter((todo) => todo.dueDate && todo.dueDate < today && !todo.done),
    conflicts: selectedConflicts,
    nextFocus:
      alternateSlots[0] && incompleteTodos[0]
        ? `${formatTimeLabel(minutesToClock(alternateSlots[0].start))} for ${
            incompleteTodos[0].title
          }`
        : "No obvious focus block yet",
  };
  const weeklyPlans = weekDays.flatMap((day) => getVisiblePlans(plans, day.key));
  const weeklyReview = {
    completed: todos.filter((todo) => todo.done).length,
    avoided: todos.filter((todo) => !todo.done && todo.dueDate && todo.dueDate < today).length,
    longestStreak: habits.length
      ? Math.max(...habits.map((habit) => habit.streak))
      : 0,
    conflicts: weekDays.reduce(
      (total, day) => total + getConflicts(plans, day.key).length,
      0
    ),
  };
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const currentTimeTop = (currentMinute - DAY_START) * PX_PER_MINUTE;
  const showCurrentTime =
    today === formatDateKey(now) &&
    currentMinute >= DAY_START &&
    currentMinute <= DAY_END;

  const scrollToCurrentTime = useCallback((smooth = true) => {
    const container = timelineScrollRef.current;
    if (!container) return;
    const target = Math.max(0, currentMinute * PX_PER_MINUTE - container.clientHeight * 0.32);
    container.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
  }, [currentMinute]);

  useEffect(() => {
    if (calendarView === "month" || didInitialScroll.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToCurrentTime(false);
      didInitialScroll.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendarView, scrollToCurrentTime]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "t") {
        setSelectedDate(today);
        window.requestAnimationFrame(() => scrollToCurrentTime());
      } else if (event.key.toLowerCase() === "m") {
        setCalendarView("month");
      } else if (event.key.toLowerCase() === "w") {
        setCalendarView("week");
      } else if (event.key.toLowerCase() === "d") {
        setCalendarView("day");
      } else if (event.key.toLowerCase() === "n") {
        setActivePanel("build");
      } else if (event.key === "ArrowLeft") {
        previousRange();
      } else if (event.key === "ArrowRight") {
        nextRange();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function handleTimelineScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const start = Math.max(0, Math.floor(target.scrollTop / (60 * PX_PER_MINUTE)) - 2);
    const end = Math.min(24, Math.ceil((target.scrollTop + target.clientHeight) / (60 * PX_PER_MINUTE)) + 2);
    if (start !== visibleHourRange.start || end !== visibleHourRange.end) {
      setVisibleHourRange({ start, end });
    }
  }

  function moveRange(direction: -1 | 1) {
    const selected = new Date(`${selectedDate}T00:00:00`);
    if (calendarView === "month") {
      selected.setMonth(selected.getMonth() + direction);
      setSelectedDate(formatDateKey(selected));
      return;
    }
    setSelectedDate(
      formatDateKey(addDays(selected, direction * (calendarView === "day" ? 1 : 7)))
    );
  }

  function previousRange() {
    moveRange(-1);
  }

  function nextRange() {
    moveRange(1);
  }

  function addManualPlan() {
    if (!title.trim()) return;

    if (builderDuration <= 0) {
      setBuilderMessage("End time must be after start time.");
      return;
    }

    const dayPlans = getVisiblePlans(plans, date);
    const used = scheduledMinutes(dayPlans);
    if (used + builderDuration > DAY_MINUTES * (1 - UNSCHEDULED_TARGET)) {
      setBuilderMessage(
        "This makes the day too packed. Keep about 20% unscheduled or choose an alternate slot."
      );
      return;
    }

    const conflicts = dayPlans.filter((plan) => {
      const range = planRange(plan);
      return rangesOverlap(clockToMinutes(startTime), clockToMinutes(endTime), range.start, range.end);
    });

    addPlan({
      title: title.trim(),
      date,
      startLabel: formatTimeLabel(startTime),
      endLabel: formatTimeLabel(endTime),
      recurrence,
      category,
      priority,
      notes,
      customRecurrence,
      seriesId: recurrence === "none" ? undefined : `${Date.now()}`,
    });

    setBuilderMessage(
      conflicts.length
        ? `Added with ${conflicts.length} conflict warning.`
        : "Added to schedule."
    );
    setTitle("");
    setNotes("");
  }

  function movePlan(planId: number, newDate: string, start?: number) {
    const plan = plans.find((candidate) => candidate.id === planId);
    if (!plan) return;
    const duration = Math.max(15, planRange(plan).end - planRange(plan).start);
    updatePlan(planId, {
      date: newDate,
      ...(typeof start === "number"
        ? {
            startLabel: formatTimeLabel(minutesToClock(start)),
            endLabel: formatTimeLabel(minutesToClock(Math.min(DAY_END, start + duration))),
          }
        : {}),
    });
    setSelectedDate(newDate);
  }

  function dropPlan(event: DragEvent<HTMLDivElement>, newDate: string) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData("text/plain"));
    if (!id) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, Math.min(DAY_END - 15, (event.clientY - bounds.top) / PX_PER_MINUTE));
    movePlan(id, newDate, Math.round(raw / 15) * 15);
  }

  function editOccurrence(plan: SavedPlan, newDate: string) {
    updatePlan(plan.id, {
      excludedDates: [...(plan.excludedDates ?? []), newDate],
    });
    addPlan({
      title: `${plan.title} (one day)`,
      date: newDate,
      startLabel: plan.startLabel,
      endLabel: plan.endLabel,
      recurrence: "none",
      category: plan.category,
      priority: plan.priority,
      notes: plan.notes,
      customRecurrence: plan.customRecurrence,
      seriesId: plan.seriesId,
    });
  }

  function importEmailText() {
    const text = emailText.trim();
    if (!text) {
      setEmailImportStatus("Paste an email first, then import it.");
      return;
    }

    const subject =
      text.match(/^subject:\s*(.+)$/im)?.[1] ??
      text.split(/\r?\n/).find(Boolean) ??
      "Email event";
    const dateMatch =
      text.match(/\b(\d{4}-\d{2}-\d{2})\b/) ??
      text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    let emailDate = selectedDate;
    let emailTime = "09:00";

    if (dateMatch?.[0]?.includes("-")) emailDate = dateMatch[0];
    if (timeMatch) {
      let hour = Number(timeMatch[1]);
      const minute = timeMatch[2] ?? "00";
      const period = timeMatch[3].toLowerCase();
      if (period === "pm" && hour !== 12) hour += 12;
      if (period === "am" && hour === 12) hour = 0;
      emailTime = `${String(hour).padStart(2, "0")}:${minute}`;
    }

    addPlan({
      title: subject,
      date: emailDate,
      startLabel: formatTimeLabel(emailTime),
      endLabel: addMinutesToLabel(emailTime, 60),
      recurrence: "none",
      category: "work",
      priority: "medium",
      notes: text,
    });
    setSelectedDate(emailDate);
    setEmailText("");
    setEmailImportStatus(`Added "${subject}" to ${emailDate}.`);
  }

  async function scanGmail() {
    setIsScanningGmail(true);
    setEmailImportStatus("Scanning recent Gmail messages for schedule items...");

    try {
      const response = await fetch("/api/gmail/import", {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      const data = (await response.json()) as {
        connected?: boolean;
        suggestions?: EmailCalendarSuggestion[];
      };

      if (!data.connected) {
        setEmailImportStatus("Gmail is not connected yet. Connect Gmail first.");
        return;
      }

      setGmailSuggestions(data.suggestions ?? []);
      setEmailImportStatus(
        data.suggestions?.length
          ? `Found ${data.suggestions.length} Gmail schedule candidate(s).`
          : "No recent Gmail messages with clear dates and times were found."
      );
    } catch (error) {
      console.error("Gmail scan failed:", error);
      setEmailImportStatus("Gmail scan failed. Check the dev server logs.");
    } finally {
      setIsScanningGmail(false);
    }
  }

  function addGmailSuggestion(suggestion: EmailCalendarSuggestion) {
    addPlan({
      title: suggestion.title,
      date: suggestion.date,
      startLabel: formatTimeLabel(suggestion.time),
      endLabel: addMinutesToLabel(suggestion.time, suggestion.duration),
      recurrence: "none",
      category: suggestion.category,
      priority: "medium",
      notes: suggestion.source,
    });
    setSelectedDate(suggestion.date);
    setGmailSuggestions((prev) =>
      prev.filter((candidate) => candidate.id !== suggestion.id)
    );
  }

  function buildOptimizerSuggestions() {
    const suggestions: OptimizerSuggestion[] = [];

    weekDays.forEach((day) => {
      const dayPlans = getVisiblePlans(plans, day.key).filter(
        (plan) => !plan.allDay
      );
      const slots = findOpenSlots(dayPlans, 45, 2);

      slots.forEach((slot, index) => {
        const todo = incompleteTodos[index];
        if (!todo) return;

        suggestions.push({
          id: `${day.key}-${todo.id}-${slot.start}`,
          title: todo.title,
          date: day.key,
          startTime: minutesToClock(slot.start),
          endTime: minutesToClock(slot.end),
          category: "work",
          priority: todo.priority,
          notes: "AI optimizer suggestion. Leaves unscheduled buffer.",
        });
      });
    });

    setOptimizerSuggestions(suggestions.slice(0, 8));
  }

  function approveOptimizerSuggestion(suggestion: OptimizerSuggestion) {
    addPlan({
      title: suggestion.title,
      date: suggestion.date,
      startLabel: formatTimeLabel(suggestion.startTime),
      endLabel: formatTimeLabel(suggestion.endTime),
      recurrence: "none",
      category: suggestion.category,
      priority: suggestion.priority,
      notes: suggestion.notes,
    });
    setOptimizerSuggestions((prev) =>
      prev.filter((candidate) => candidate.id !== suggestion.id)
    );
  }

  function addAllOptimizerSuggestions() {
    optimizerSuggestions.forEach(approveOptimizerSuggestion);
  }

  return (
    <div className="min-h-screen text-slate-950">
      <main className="calendar-page mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="calendar-header flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="calendar-eyebrow">Schedule</p>
            <h1>Calendar</h1>
            <CalendarSyncIndicator
              compact
              status={calendarSync.status}
              loading={calendarSync.loading}
              onSync={() => void calendarSync.syncNow()}
              onConnect={() => void calendarSync.connect()}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={previousRange}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <button
              onClick={() => {
                setSelectedDate(today);
                window.requestAnimationFrame(() => scrollToCurrentTime());
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Today
            </button>
            <button
              onClick={nextRange}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Next
              <ChevronRight size={16} />
            </button>
            <button
              onClick={buildOptimizerSuggestions}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              <Wand2 size={16} />
              Optimize Gaps
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-5">
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-100 bg-white/90 p-2 shadow-sm">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {[
                  ["build", "Build"],
                  ["habits", "Habits"],
                  ["insights", "AI"],
                  ["email", "Email"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setActivePanel(
                        activePanel === key
                          ? "none"
                          : (key as Exclude<typeof activePanel, "none">)
                      )
                    }
                    className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                      activePanel === key
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-emerald-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 border-t border-emerald-100 pt-2">
                {(["month", "week", "day"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCalendarView(mode)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium capitalize ${
                      calendarView === mode
                        ? "bg-blue-600 text-white"
                        : "text-slate-600 hover:bg-blue-50"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {calendarActionError ? (
              <div className="ass-inline-error" role="alert">
                <AlertTriangle size={17} aria-hidden="true" />
                <span>{calendarActionError}</span>
              </div>
            ) : null}

            <section
              className={`rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50 to-blue-50 p-4 text-emerald-950 shadow-sm ${
                activePanel === "insights" ? "block" : "hidden"
              }`}
            >
              <h2 className="font-semibold">Adaptive Strategy</h2>
              <p className="mt-2 text-sm">
                UI mode: {learning.guiDensity}. Best schedule bias:{" "}
                {learning.preferredTimeOfDay}. Accent category:{" "}
                {learning.preferredCategory}.
              </p>
              <div className="mt-3 space-y-2">
                {learning.strategies.slice(0, 2).map((strategy) => (
                  <div key={strategy.id} className="rounded-lg bg-white/70 p-3">
                    <div className="text-sm font-medium">{strategy.title}</div>
                    <div className="mt-1 text-xs">{strategy.action}</div>
                  </div>
                ))}
              </div>
            </section>

            <section
              className={`rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
                activePanel === "habits" ? "block" : "hidden"
              }`}
            >
              <h2 className="font-semibold">Daily Habits</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {habits.map((habit) => {
                  const done = habit.lastCompleted === today;

                  return (
                    <button
                      key={habit.id}
                      onClick={() => toggleHabit(habit.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                        done
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {habit.name} · {habit.streak}
                    </button>
                  );
                })}
                {habits.length === 0 && (
                  <div className="text-sm text-slate-500">No habits yet.</div>
                )}
              </div>
            </section>

            <section
              className={`rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
                activePanel === "build" ? "block" : "hidden"
              }`}
            >
              <h2 className="font-semibold">Manual Schedule Builder</h2>
              <div className="mt-3 grid gap-2">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setSelectedDate(event.target.value);
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as PlanCategory)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  >
                    {(Object.keys(CATEGORIES) as PlanCategory[]).map((item) => (
                      <option key={item} value={item}>
                        {CATEGORIES[item].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={recurrence}
                    onChange={(event) =>
                      setRecurrence(event.target.value as PlanRecurrence)
                    }
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as PlanPriority)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  >
                    <option value="low">Low priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="high">High priority</option>
                  </select>
                </div>
                {recurrence === "custom" && (
                  <input
                    value={customRecurrence}
                    onChange={(event) => setCustomRecurrence(event.target.value)}
                    placeholder="Custom recurrence, e.g. every other day or Monday Wednesday Friday"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                )}
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Notes"
                  className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
                <button
                  onClick={addManualPlan}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Plus size={16} />
                  Add Schedule Block
                </button>
              </div>

              {(builderConflicts.length > 0 || selectedImpossible || builderMessage) && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  {builderConflicts.length > 0 && (
                    <div>
                      Warning: overlaps {builderConflicts.length} event(s) on the selected day.
                    </div>
                  )}
                  {selectedImpossible && (
                    <div>This day is above the 80% scheduled limit.</div>
                  )}
                  {builderMessage && <div>{builderMessage}</div>}
                </div>
              )}

              {alternateSlots.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-slate-500">
                    Alternate open slots
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {alternateSlots.map((slot) => (
                      <button
                        key={`${slot.start}-${slot.end}`}
                        onClick={() => {
                          setStartTime(minutesToClock(slot.start));
                          setEndTime(minutesToClock(slot.end));
                        }}
                        className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 ring-1 ring-cyan-100"
                      >
                        {formatTimeLabel(minutesToClock(slot.start))}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section
              className={`rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
                activePanel === "insights" ? "block" : "hidden"
              }`}
            >
              <h2 className="font-semibold">AI Daily Briefing</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>Overdue tasks: {dailyBriefing.overdue.length}</div>
                <div>Habits pending: {pendingHabits.length}</div>
                <div>Schedule conflicts: {dailyBriefing.conflicts.length}</div>
                <div>Recommended focus: {dailyBriefing.nextFocus}</div>
              </div>
            </section>

            <section
              className={`rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
                activePanel === "insights" ? "block" : "hidden"
              }`}
            >
              <h2 className="font-semibold">AI Weekly Review</h2>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div>Completed tasks: {weeklyReview.completed}</div>
                <div>Avoided or overdue: {weeklyReview.avoided}</div>
                <div>Longest habit streak: {weeklyReview.longestStreak}</div>
                <div>Week conflicts: {weeklyReview.conflicts}</div>
                <div>Scheduled blocks: {weeklyPlans.length}</div>
              </div>
            </section>

            <section
              className={`rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
                activePanel === "email" ? "block" : "hidden"
              }`}
            >
              <div className="flex items-center gap-2">
                <Mail className="text-indigo-500" size={18} />
                <h2 className="font-semibold">Gmail Intake</h2>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    void calendarSync.connect();
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Connect Gmail
                </button>
                <button
                  onClick={scanGmail}
                  disabled={isScanningGmail}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isScanningGmail ? "Scanning..." : "Scan Gmail"}
                </button>
              </div>
              <textarea
                value={emailText}
                onChange={(event) => setEmailText(event.target.value)}
                placeholder="Paste an email with a subject, date, and time..."
                className="mt-3 min-h-24 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
              />
              <button
                onClick={importEmailText}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Plus size={16} />
                Add Email Event
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {emailImportStatus}
              </p>
              {gmailSuggestions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {gmailSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="text-sm font-medium">{suggestion.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {suggestion.date} at {formatTimeLabel(suggestion.time)}
                      </div>
                      <button
                        onClick={() => addGmailSuggestion(suggestion)}
                        className="mt-2 rounded-md bg-white px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50"
                      >
                        Add to calendar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {calendarView === "month" ? (
            <section
              className="month-calendar"
              onTouchStart={(event) => {
                touchStartX.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStartX.current === null) return;
                const distance = event.changedTouches[0]?.clientX - touchStartX.current;
                if (Math.abs(distance) > 55) moveRange(distance > 0 ? -1 : 1);
                touchStartX.current = null;
              }}
            >
              <div className="month-calendar__header">
                <div>
                  <span className="ass-kicker">Month</span>
                  <h2>
                    {monthStart.toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                </div>
                <span>Swipe or use ← →</span>
              </div>
              <div className="month-calendar__weekdays" aria-hidden="true">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="month-calendar__grid">
                {monthDays.map((day) => {
                  const visible = day.plans.slice(0, 3);
                  const hiddenCount = Math.max(0, day.plans.length - visible.length);
                  return (
                    <div
                      key={day.key}
                      className={`month-day ${day.currentMonth ? "" : "is-outside"} ${
                        day.key === today ? "is-today" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="month-day__number"
                        onClick={() => {
                          setSelectedDate(day.key);
                          setDate(day.key);
                          setCalendarView("day");
                        }}
                        aria-label={`Open ${dateLabel(day.key)}`}
                      >
                        {day.number}
                      </button>
                      <div className="month-day__events">
                        {visible.map((plan) => (
                          <button
                            key={`${day.key}-${plan.id}`}
                            type="button"
                            title={`${plan.title}, ${plan.startLabel}`}
                            onClick={() => {
                              setSelectedDate(day.key);
                              setDate(day.key);
                              setCalendarView("day");
                            }}
                            className="month-event"
                            style={{
                              borderColor: plan.googleColor || "var(--blue)",
                            }}
                          >
                            <span>{plan.allDay ? "" : plan.startLabel}</span>
                            <strong>{plan.title}</strong>
                          </button>
                        ))}
                        {hiddenCount > 0 ? (
                          <button
                            type="button"
                            className="month-day__more"
                            onClick={() =>
                              setMonthPopoverDate(
                                monthPopoverDate === day.key ? null : day.key
                              )
                            }
                          >
                            +{hiddenCount} more
                          </button>
                        ) : null}
                      </div>
                      {monthPopoverDate === day.key ? (
                        <div className="month-popover">
                          <strong>{dateLabel(day.key)}</strong>
                          {day.plans.map((plan) => (
                            <button
                              key={`popover-${plan.id}`}
                              type="button"
                              onClick={() => {
                                setSelectedDate(day.key);
                                setDate(day.key);
                                setCalendarView("day");
                              }}
                            >
                              <i style={{ background: plan.googleColor || "var(--blue)" }} />
                              <span>{plan.title}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
          <section
            className="calendar-surface overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              if (touchStartX.current === null) return;
              const distance = event.changedTouches[0]?.clientX - touchStartX.current;
              if (Math.abs(distance) > 70) moveRange(distance > 0 ? -1 : 1);
              touchStartX.current = null;
            }}
          >
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {dateLabel(weekDays[0].key)} - {dateLabel(weekDays[6].key)}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Events are positioned by exact start and end minute.
                  </p>
                </div>

                {selectedConflicts.length > 0 && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle size={16} />
                    {selectedConflicts.length} overlap warning(s)
                  </div>
                )}
              </div>
            </div>

            <div className="hidden">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {weekDays.map((day) => {
                  const holiday = weekHolidays.find((item) => item.date === day.key);

                  return (
                    <button
                      key={day.key}
                      onClick={() => {
                        setSelectedDate(day.key);
                        setDate(day.key);
                      }}
                      className={`min-w-20 rounded-2xl px-3 py-2 text-left shadow-sm ${
                        selectedDate === day.key
                          ? "bg-emerald-600 text-white"
                          : "bg-white text-slate-700"
                      }`}
                    >
                      <div className="text-xs opacity-80">{day.label}</div>
                      <div className="flex items-center gap-1">
                        <span className="text-xl font-semibold">{day.dayNumber}</span>
                        {holiday && (
                          <span className="h-2 w-2 rounded-full bg-amber-400" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="hidden">
              <div className="p-4">
                <div className="ios-card rounded-3xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-emerald-700">
                        {dateLabel(selectedDate)}
                      </div>
                      <h3 className="text-2xl font-semibold text-emerald-950">
                        Day View
                      </h3>
                    </div>
                    {selectedConflicts.length > 0 && (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                        {selectedConflicts.length} overlap
                      </span>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {selectedOpenGaps.length > 0 && (
                      <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/70 p-3">
                        <div className="text-sm font-semibold text-emerald-950">
                          Open gaps
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedOpenGaps.map((gap) => (
                            <button
                              key={`${gap.start}-${gap.end}-mobile-gap`}
                              onClick={() => {
                                setActivePanel("build");
                                setStartTime(minutesToClock(gap.start));
                                setEndTime(minutesToClock(Math.min(gap.end, gap.start + 60)));
                              }}
                              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100"
                            >
                              {formatTimeLabel(minutesToClock(gap.start))} -{" "}
                              {formatTimeLabel(minutesToClock(gap.end))}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedHolidays.map((holiday) => (
                      <article
                        key={`${holiday.date}-${holiday.name}-mobile`}
                        className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <CalendarDays size={16} />
                          {holiday.name}
                        </div>
                        <div className="mt-1 text-xs text-amber-700">
                          {holiday.observed ? "Observed holiday" : "Federal holiday"}
                        </div>
                      </article>
                    ))}
                    {selectedDayPlans.map((plan) => {
                      const categoryMeta = CATEGORIES[plan.category ?? "other"];

                      return (
                        <article
                          key={`${plan.id}-mobile`}
                          className={`rounded-2xl border-l-4 p-3 ${categoryMeta.block}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{plan.title}</div>
                              <div className="mt-1 text-sm opacity-80">
                                {plan.startLabel} - {plan.endLabel}
                              </div>
                              <div className="mt-1 text-xs capitalize opacity-75">
                                {plan.category ?? "other"} - {plan.recurrence}
                              </div>
                            </div>
                            <button
                              onClick={() => void handleDeletePlan(plan)}
                              className="rounded-full bg-white/70 p-2"
                              aria-label={`Delete ${plan.title}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {selectedDayPlans.length === 0 && selectedHolidays.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/70 p-4 text-sm text-slate-500">
                        No events for this day yet. Use the Build tab to add one.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {optimizerSuggestions.length > 0 && (
              <div className="border-b border-slate-200 bg-indigo-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-indigo-950">
                      AI Schedule Optimizer Suggestions
                    </h3>
                    <p className="text-sm text-indigo-700">
                      Review cards before adding. These keep a 20% buffer when possible.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={addAllOptimizerSuggestions}
                      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
                    >
                      <Check size={15} />
                      Add all
                    </button>
                    <button
                      onClick={() => setOptimizerSuggestions([])}
                      className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200"
                    >
                      <X size={15} />
                      Reject
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {optimizerSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="rounded-lg bg-white p-3 text-sm shadow-sm ring-1 ring-indigo-100"
                    >
                      <div className="font-medium">{suggestion.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {suggestion.date} · {formatTimeLabel(suggestion.startTime)}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => approveOptimizerSuggestion(suggestion)}
                          className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white"
                        >
                          Add
                        </button>
                        <button
                          onClick={() =>
                            setOptimizerSuggestions((prev) =>
                              prev.filter((item) => item.id !== suggestion.id)
                            )
                          }
                          className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="hidden border-r border-slate-200 bg-slate-50/80 p-4 md:block">
                <button
                  onClick={() => setActivePanel(activePanel === "build" ? "none" : "build")}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <Plus size={18} />
                  Create
                </button>

                <div className="mini-calendar mt-5 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800">
                      {monthStart.toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="mini-calendar__weekdays mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
                    {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                      <div key={`${day}-${index}`}>{day}</div>
                    ))}
                  </div>
                  <div className="mini-calendar__grid mt-2 grid grid-cols-7 gap-1">
                    {miniCalendarDays.map((day) => (
                      <button
                        key={day.key}
                        onClick={() => {
                          setSelectedDate(day.key);
                          setDate(day.key);
                          setCalendarView("day");
                        }}
                        className={`aspect-square rounded-full text-xs ${
                          selectedDate === day.key
                            ? "bg-blue-600 font-semibold text-white"
                            : day.key === today
                            ? "bg-blue-50 font-semibold text-blue-700"
                            : day.currentMonth
                            ? "text-slate-700 hover:bg-slate-100"
                            : "text-slate-300"
                        }`}
                      >
                        <span>{day.number}</span>
                        {getVisiblePlans(plans, day.key).length > 0 ? <i aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </div>

              </aside>

              <div
                ref={timelineScrollRef}
                onScroll={handleTimelineScroll}
                className="calendar-timeline-scroll overflow-auto"
              >
                <div className="min-w-[980px]">
                <div
                  className="sticky top-0 z-20 grid border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur"
                  style={{ gridTemplateColumns: desktopGridColumns }}
                >
                  <div className="sticky left-0 z-30 border-r border-slate-200 bg-slate-50 px-3 py-3 text-xs font-medium text-slate-500">
                    Local time
                  </div>
                  {calendarDays.map((day) => {
                    const dayConflicts = getConflicts(plans, day.key);
                    const holiday = weekHolidays.find(
                      (item) => item.date === day.key
                    );
                    return (
                      <button
                        key={day.key}
                        onClick={() => {
                          setSelectedDate(day.key);
                          setDate(day.key);
                        }}
                        className={`border-l border-slate-200 p-3 text-left ${
                          selectedDate === day.key ? "bg-blue-50" : ""
                        }`}
                      >
                        <div className="text-xs font-medium text-slate-500">
                          {day.label}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xl font-semibold">{day.dayNumber}</span>
                          {day.key === today && (
                            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
                              Today
                            </span>
                          )}
                          {dayConflicts.length > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              {dayConflicts.length} overlap
                            </span>
                          )}
                        </div>
                        {holiday && (
                          <div className="mt-2 truncate rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                            {holiday.name}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div
                  className="grid border-b border-slate-200 bg-white"
                  style={{ gridTemplateColumns: desktopGridColumns }}
                >
                  <div className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                    All day
                  </div>
                  {calendarDays.map((day) => {
                    const holiday = weekHolidays.find(
                      (item) => item.date === day.key
                    );
                    const allDayPlans = getVisiblePlans(plans, day.key).filter(
                      (plan) => plan.allDay
                    );

                    return (
                      <div
                        key={`${day.key}-all-day`}
                        className="min-h-12 border-l border-slate-200 p-2"
                      >
                        {holiday && (
                          <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                            <CalendarDays size={13} />
                            <span className="truncate">
                              {holiday.name}
                              {holiday.observed ? " (observed)" : ""}
                            </span>
                          </div>
                        )}
                        {allDayPlans.map((plan) => (
                          <div
                            key={`${plan.id}-${day.key}-all-day`}
                            className="mt-1 truncate rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800"
                          >
                            {plan.title}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>

                <div
                  className="relative grid"
                  style={{
                    minHeight: `${timelineHeight}px`,
                    gridTemplateColumns: desktopGridColumns,
                  }}
                >
                  <div className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50">
                    {hours
                      .filter(
                        (hour) =>
                          hour >= visibleHourRange.start &&
                          hour <= visibleHourRange.end
                      )
                      .map((hour) => (
                      <div
                        key={hour}
                        className="absolute right-3 text-xs font-medium text-slate-500"
                        style={{
                          top: `${(hour * 60 - DAY_START) * PX_PER_MINUTE - 8}px`,
                        }}
                      >
                        {formatHour(hour)}
                      </div>
                    ))}
                  </div>

                  {calendarDays.map((day) => {
                    const dayPlans = getVisiblePlans(plans, day.key).filter(
                      (plan) => !plan.allDay
                    );
                    const conflicts = getConflicts(plans, day.key);
                    const conflictIds = new Set(
                      conflicts.flatMap((conflict) => [conflict.a.id, conflict.b.id])
                    );

                    return (
                      <div
                        key={day.key}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event: DragEvent<HTMLDivElement>) =>
                          dropPlan(event, day.key)
                        }
                        className="relative border-l border-slate-200"
                        style={{
                          minHeight: `${timelineHeight}px`,
                          backgroundImage:
                            "linear-gradient(to bottom, rgba(148, 163, 184, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.14) 1px, transparent 1px)",
                          backgroundSize: `${60 * PX_PER_MINUTE}px ${
                            60 * PX_PER_MINUTE
                          }px, ${15 * PX_PER_MINUTE}px ${15 * PX_PER_MINUTE}px`,
                        }}
                      >
                        {showCurrentTime && day.key === today && (
                          <div
                            className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-rose-500"
                            style={{ top: `${currentTimeTop}px` }}
                          >
                            <span className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-rose-500" />
                          </div>
                        )}
                        {dayPlans.map((plan, index) => {
                          const categoryMeta = CATEGORIES[plan.category ?? "other"];
                          const hasConflict = conflictIds.has(plan.id);

                          return (
                            <article
                              key={`${plan.id}-${day.key}`}
                              draggable
                              onDragStart={(event) =>
                                event.dataTransfer.setData("text/plain", String(plan.id))
                              }
                              className={`calendar-event absolute z-10 overflow-hidden rounded-lg border-l-4 px-2 py-2 shadow-sm ${categoryMeta.block} ${
                                hasConflict ? "ring-2 ring-amber-300" : ""
                              }`}
                              style={{
                                ...eventStyle(plan, hasConflict ? 1 : 0),
                                left: `${8 + (hasConflict ? index % 2 : 0) * 14}px`,
                                ...(plan.googleColor
                                  ? {
                                      borderColor: plan.googleColor,
                                      backgroundColor: `color-mix(in srgb, ${plan.googleColor} 13%, var(--surface-solid))`,
                                    }
                                  : {}),
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold">
                                    {plan.title}
                                  </div>
                                  <div className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
                                    <Clock size={11} />
                                    {plan.startLabel} - {plan.endLabel}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] capitalize opacity-75">
                                    {plan.priority ?? "medium"} · {plan.recurrence}
                                  </div>
                                </div>
                                <button
                                  onClick={() => void handleDeletePlan(plan)}
                                  className="rounded-md bg-white/75 p-1 text-slate-600 hover:bg-white hover:text-rose-600"
                                  aria-label={`Delete ${plan.title}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              {plan.recurrence !== "none" && (
                                <div className="mt-2 flex gap-1">
                                  <button
                                    onClick={() => editOccurrence(plan, day.key)}
                                    className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium"
                                  >
                                    Edit one
                                  </button>
                                  <button
                                    onClick={() => {
                                      setTitle(plan.title);
                                      setDate(plan.date);
                                      setStartTime(minutesToClock(planRange(plan).start));
                                      setEndTime(minutesToClock(planRange(plan).end));
                                      setRecurrence(plan.recurrence);
                                      setCategory(plan.category ?? "other");
                                      setPriority(plan.priority ?? "medium");
                                      setNotes(plan.notes ?? "");
                                    }}
                                    className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium"
                                  >
                                    Edit series
                                  </button>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>
          </section>
          )}
        </div>
      </main>
    </div>
  );
}
