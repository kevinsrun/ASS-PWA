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
  source?: "ass" | "google";
  googleEventId?: string;
  googleAccountId?: string;
  googleCalendarId?: string;
  googleRecurringEventId?: string;
  googleColor?: string;
  googleEtag?: string;
  googleUpdatedAt?: string;
  allDay?: boolean;
  canonicalEventId?: string;
  optionality?: "required" | "recommended" | "optional" | "tentative" | "unknown";
  attendancePolicy?: "mandatory_attendance" | "graded_participation" | "attendance_recommended" | "attendance_optional" | "not_specified";
  classificationConfidence?: number;
  classificationReason?: string;
  blockingStatus?: "busy" | "free";
  sourceLabel?: string;
};

export type GoogleCalendarSummary = {
  id: string;
  accountId: string;
  name: string;
  color: string | null;
  accessRole: string;
  primary: boolean;
  state: CalendarSyncState;
  lastSuccessfulSyncAt: string | null;
  error: string | null;
};

export type GoogleAccountSummary = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  color: string | null;
  state: CalendarSyncState;
  lastSuccessfulSyncAt: string | null;
  lastEmailSyncAt: string | null;
  error: string | null;
  calendarCount: number;
};

export type EmailIntelligenceItem = {
  disposition?: string;
  responseNeeded?: boolean;
  id: string;
  accountEmail: string;
  sender: string;
  title: string;
  summary: string;
  type: "task" | "deadline" | "meeting" | "reminder" | "project_update" | "scholarship" | "research" | "club_event" | "financial_aid" | "travel" | "interview" | "invoice" | "finance_alert" | "calendar_conflict" | "calendar_merge" | "no_action";
  importance: "low" | "normal" | "high" | "urgent";
  actionRequired: boolean;
  date: string | null;
  time: string | null;
  conflictDetails: string[];
  recommendations: string[];
  receivedAt: string | null;
};

export type CalendarSyncState =
  | "not_connected"
  | "ready"
  | "syncing"
  | "synced"
  | "auth_expired"
  | "unreachable"
  | "misconfigured"
  | "error";

export type CalendarSyncStatus = {
  state: CalendarSyncState;
  connected: boolean;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  timeZone: string | null;
  eventsImported?: number;
  connectedEmail: string | null;
  calendars: GoogleCalendarSummary[];
  accounts: GoogleAccountSummary[];
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
  sources?: Array<{label:string;url:string;kind:"gmail"|"drive"|"document"}>;
  reconnect?: boolean;
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

export type CourseStatus =
  | "registered"
  | "shopping"
  | "waitlisted"
  | "dropped"
  | "completed";

export type AcademicCourse = {
  id: string;
  canvasId: number;
  name: string;
  code: string;
  status: CourseStatus;
  color: string;
  term: string | null;
  instructor: string | null;
  syllabusHtml: string | null;
  currentScore: number | null;
  currentGrade: string | null;
  startAt: string | null;
  endAt: string | null;
};

export type AcademicAssignment = {
  id: string;
  canvasId: number;
  courseId: string;
  courseCanvasId: number;
  title: string;
  descriptionHtml: string | null;
  dueAt: string | null;
  unlockAt: string | null;
  pointsPossible: number | null;
  score: number | null;
  grade: string | null;
  submitted: boolean;
  submissionStatus: string;
  submissionUrl: string | null;
  estimatedMinutes: number;
  difficulty: "low" | "medium" | "high";
  priority: PlanPriority;
  recommendedStartAt: string | null;
  recommendedCompleteAt: string | null;
};

export type AcademicResourceType =
  | "module"
  | "page"
  | "announcement"
  | "calendar_event"
  | "file"
  | "discussion";

export type AcademicResource = {
  id: string;
  courseId: string | null;
  courseCanvasId: number | null;
  externalId: string;
  type: AcademicResourceType;
  title: string;
  url: string | null;
  publishedAt: string | null;
  dueAt: string | null;
  completed: boolean;
  metadata: Record<string, unknown>;
};

export type AcademicSnapshot = {
  courses: AcademicCourse[];
  assignments: AcademicAssignment[];
  resources: AcademicResource[];
  syncedAt: string | null;
};
