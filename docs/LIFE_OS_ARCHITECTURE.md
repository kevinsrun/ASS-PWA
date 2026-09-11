# ASS Life OS architecture

## Architecture review

ASS already has a useful vertical core: tasks, habits, journal entries, calendar
plans, a deterministic planner, Gemini-backed interpretation, Google OAuth, Gmail
ingestion, Supabase authentication, and a PWA shell. The best path is to keep
those domain rules and place every client behind the same authenticated HTTP and
Supabase boundary.

The main architectural risks in the original implementation are:

- browser state still acts as the first source of truth before cloud hydration;
- cloud sync replaces whole user tables instead of applying record-level changes;
- Google credentials are written to a local JSON file, which does not work safely
  across server instances or users;
- API routes accept large client-provided context objects without a shared domain
  contract;
- academic, email, and calendar records are not yet connected by durable IDs.

The Canvas slice in this release establishes the intended direction: Canvas
credentials remain server-only, the caller is authenticated with a Supabase
access token, normalized records are written to owner-scoped tables, and the same
endpoint can be called by the web app or a native iOS client.

## Target system

```text
Next.js web ───────┐
                   ├── ASS API layer ── domain services ── Gemini
SwiftUI iOS ───────┘          │
                              ├── Supabase Auth + Postgres + Storage
                              ├── Canvas LMS
                              ├── Gmail
                              └── Google Calendar
```

Supabase is authoritative. Local storage, SwiftData, and URL cache are offline
caches only. The planner receives normalized tasks, events, habits, assignments,
and constraints; clients render planner output and submit explicit mutations.

## Folder structure

```text
src/
  app/
    academics/                 Academic Command Center
    api/
      canvas/sync/             authenticated Canvas ingestion endpoint
      chat/                    Gemini assistant endpoint
      auth/google/             Google OAuth boundary
  hooks/
    useAcademicData.ts         browser cache/query adapter
  lib/
    academic.ts                academic selectors and row mapping
    canvas.ts                  server-only Canvas client and normalization
    planner.ts                 shared scheduling rules
    supabase*.ts               client/server persistence boundaries
  providers/                   authenticated client state
supabase/
  schema.sql                   reproducible schema and RLS policies
ios/
  ASSApp/                      SwiftUI application target (next release)
  ASSKit/                      generated API DTOs and shared client services
```

## Database review

Existing tables cover profiles, tasks, habits, journal entries, plans, Google
tokens, email suggestions, and automation runs. This release adds:

- `academic_courses`: Canvas identity, enrollment status, instructor, syllabus,
  term, grade, and course color;
- `academic_assignments`: due/submission data plus planner intelligence and links
  to generated tasks or calendar blocks;
- `academic_resources`: normalized modules, pages, announcements, files,
  discussions, and Canvas calendar events;
- `academic_sync_runs`: observable sync outcomes and counts.

All exposed tables have RLS enabled. Policies explicitly target the
`authenticated` role and enforce `auth.uid() = user_id`; anonymous table grants
are revoked. The service role is server-only and is used only after validating
the caller's access token.

## API review

`POST /api/canvas/sync` is the first shared mobile/web endpoint. It:

1. requires `Authorization: Bearer <Supabase access token>`;
2. validates the session with Supabase Auth;
3. fetches paginated Canvas collections with bounded retries and timeouts;
4. normalizes courses, assignments, modules, pages, announcements, files,
   discussions, and calendar events;
5. computes initial effort, difficulty, priority, and recommended start windows;
6. upserts owner-scoped rows and records the sync result;
7. returns the normalized academic snapshot.

The next API increment should extract the same authentication guard into a shared
module and add versioned endpoints for planner mutations, Google Calendar CRUD,
email decisions, chat streams, journal attachments, and search.

## SwiftUI architecture

Use a feature-first SwiftUI application with the Observation framework:

- `ASSClient`: actor-backed, async/await HTTP client that attaches the current
  Supabase access token and decodes versioned DTOs;
- `SessionStore`: Supabase/Apple/Google sign-in state and token refresh;
- `HomeFeature`, `CalendarFeature`, `AcademicsFeature`, `ChatFeature`, and
  `JournalFeature`: `@Observable` models with explicit loading, loaded, empty,
  and error states;
- `OfflineStore`: SwiftData cache with a queued mutation outbox;
- `BackgroundSync`: `BackgroundTasks` refresh that invokes the same ASS API;
- `WidgetDataStore`: app-group snapshot for WidgetKit and App Intents;
- `NavigationStack` with typed destinations and universal links.

Business rules stay on the API/domain side. Swift code owns presentation,
offline cache policy, native integrations, and optimistic interaction only.

## Implementation roadmap

### Release 1 — academic vertical slice (implemented here)

- polished Life OS home surface;
- Academic Command Center with editable shopping/registered status;
- Canvas synchronization and normalized Supabase storage;
- assignment effort/priority recommendations;
- one-tap conversion of assignments into existing ASS tasks;
- secure owner-scoped RLS and API authentication.

### Release 2 — planner and calendar authority

- replace snapshot table rewrites with record-level optimistic mutations;
- add projects and a relation graph for tasks, events, notes, files, goals, and
  courses;
- move Google OAuth tokens into server-side encrypted storage;
- implement Google Calendar list/create/update/delete, recurrence, invitations,
  reminders, conflict detection, and sync cursors;
- generate weekly study blocks from assignment intelligence and free-time gaps.

### Release 3 — proactive intelligence

- Gmail push notifications through Google Pub/Sub;
- structured Gemini decisions with confidence thresholds and an approval inbox;
- daily briefing and evening review persisted as first-class records;
- streaming, multi-conversation assistant with citations to ASS records;
- syllabus extraction jobs with an auditable structured result and source spans.

### Release 4 — native Apple clients

- ship `ASSKit` and the SwiftUI iPhone/iPad application;
- add widgets, App Intents, Live Activities, Spotlight, Share Sheet, Handoff,
  notifications, and Watch companion;
- validate Dynamic Type, VoiceOver, reduced motion, dark mode, and offline replay.

## Pull request sequence

1. `academic-domain-and-rls`
2. `canvas-sync-api`
3. `life-os-command-center`
4. `planner-record-mutations`
5. `google-calendar-authority`
6. `assistant-streaming-and-memory`
7. `swiftui-shell-and-asskit`

Each change should land behind a reviewable branch with schema checks, API tests,
browser verification, and a human review before merge.
