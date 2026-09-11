# ASS UI reduction decisions

## Shared components

- `BottomNav` — simplified from eight destinations to five: Home, Calendar, Projects, Chat, Profile.
- `InstallPrompt` — kept; it appears only when installation is available and supports the iOS/PWA experience.
- `TaskCard` — kept inside Projects; detailed task controls remain off Home.
- `HabitCard` — kept inside the secondary Habits area; removed from primary navigation and Home.
- `NavBar` — deleted because it was unused and duplicated navigation.

## Product surfaces

- Home — rebuilt around one decision: what to do now. Kept greeting, one focus, next event, and at most two tasks. Deleted scores, metrics, habits, academic widgets, briefings, gradients, and decorative analytics.
- Calendar — kept as the primary full-width working surface. Supporting automation panels remain secondary to the timeline.
- Projects — merges access to Tasks, Academics, Habits, and Journal while keeping Tasks as the default view.
- Chat — simplified typography and message chrome; Email and Code tools are hidden behind a single disclosure.
- Journal — changed to a distraction-free writing sheet; metadata and AI actions remain available below the writing surface.
- Profile — kept as the home for account connections and advanced configuration, away from daily work.
- Analytics — hidden from primary navigation; still available from Profile.

Color is now semantic: blue for calendar/action, green for completion, red for overdue state, and neutral surfaces everywhere else.
