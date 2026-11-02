# BetterDay: user-testing findings and next steps

Prepared November 1, 2026, from the October 30 testing-note photos, the earlier “Set up BetterDay repository” chat, the current code, and official integration documentation.

Updated after the follow-up discussion: **BetterDay's central direction is an active day planner built around dynamic scheduling.** Ranked tasks, progress tracking, and replanning form the core experience. Wake-up adjustments extend that experience; calendar connections and reminders support it. See [Product vision](product-vision.md) for the confirmed direction.

## Implementation status — November 2, 2026

The agreed local release is implemented: dropdown-first time controls; dated tasks and calendars; Preview / Apply / Undo planning; wake ranges and actual-wake adjustments; task progress, splitting, recurrence and completed history; calendar-file import/export; and reviewed backup restoration. The 100-test suite and primary browser workflows pass. See [local release and verification](local-release.md) and [saved checkpoint](resume-checkpoint.md).

The user chose to keep this release local. Live calendar connections, accounts and background notifications are deferred. Habits/hobbies/wellness remain the next product phase. The proposal sections below retain the original planning rationale; implementation status and current boundaries are recorded in the release checklist.

## Verified starting point — November 1

- Repository: https://github.com/rSpidal/betterday
- Public site: https://rspidal.github.io/betterday/
- Local checkout: `/Users/matteobotelho/Desktop/BetterDay`
- `git pull --ff-only` completed successfully and reported “Already up to date.” Local `main` and `origin/main` both point to `50e490dd3e5664edd88ea4cf0651de634d503b14`, “Build BetterDay scheduling site,” October 30, 2026.
- The latest GitHub Pages workflow succeeded for that same commit: https://github.com/rSpidal/betterday/actions/runs/41082461109
- The original baseline had 18 passing scheduling and storage tests; the implemented local release now has 100.
- Application changes are now saved locally. No new deployment has been made.

The earlier chat established a cream/green design, a home → questionnaire → schedule flow, editable events, optional retention of commitments when restarting, and a preference to defer accounts and external services. Those decisions remain the starting point.

## What the notes establish

These are summarized observations and ideas from the attached notes, not independent instructions to change the product. The user's current request determines priority.

| Finding | Implication |
| --- | --- |
| Testers found the questionnaire, generated a schedule, returned to it from home, and added events. The schedule and review summary received positive feedback. | Preserve the successful flow and visual design. |
| Users initially typed times; the dropdown became useful after prompting. One tester struggled with incomplete time entry and AM/PM. | Make selection visibly available before interaction and remove required AM/PM typing. |
| The notes mention an attempted plus/Enter interaction on commitments. The exact gesture is ambiguous. | Observe adding another commitment and Enter-key behavior in the next test; do not assume a specific confirmed bug. |
| A tester requested a range for bedtime and wake-up time. | Explore flexible sleep windows separately from the first time-control fix. |
| Calendar import/export and event reminders were requested. | Add calendar exchange and reminders to the roadmap. |
| The takeaways describe dynamic overrides, priorities, replacing/overlapping commitments, and one-time versus recurring events. | Introduce explicit scheduling rules and a real dated calendar before enabling those behaviors. |

## 1. First release: make time selection obvious

Use a shared time control everywhere: usual sleep, day-specific sleep, questionnaire commitments, and the calendar's add/edit dialog.

Proposed layout: **Starts [hour ▾] : [minute ▾] [AM | PM]** and the equivalent Ends row. Hour and minute selection should be the primary interaction, with clear dropdown arrows and a strongly visible selected AM/PM button. Users must be able to complete the flow without typing. Keyboard selection remains available; an optional explicit custom-entry path can be retained if testing shows value.

For new events, once the start is complete, suggest an end one hour later. Calculate the period from the full time: 11:30 AM → 12:30 PM. Keep updating this suggestion only until the user changes the end. Preserve an explicitly chosen end and all saved event values. Do not apply event-duration inference to wake-up/bedtime fields, or silently change an edited existing event's duration.

Keep all minute values available so existing times such as 11:52 are preserved. Internally retain the current 24-hour time strings, including the existing end-of-day midnight representation. Show midnight clearly as “12:00 AM — end of day” when used as an end. Do not silently wrap an unsupported overnight event into the next day; show an explanation and the existing split-across-days guidance.

Implementation touches the shared time-control module to be added, `js/questionnaire.js`, `js/app.js`, and `styles.css`. The current bare native time fields are in `js/questionnaire.js` around line 80 and `js/app.js` around line 171. No account, server, or saved-data migration is needed for this release.

Acceptance checks:

- A new tester discovers and completes time selection without prompting or typing AM/PM.
- The control works with touch, mouse, and keyboard at desktop and narrow phone widths.
- Noon, midnight, uncommon minute values, unfinished answers, and saved events survive edits and reloads.
- Start changes never overwrite an end the user explicitly selected.
- Existing sleep and overlap validation still works, and all current automated tests pass.
- Repeat create schedule → edit event → home → return to schedule; observe add-another-commitment and Enter behavior.

## 2. Foundation: turn a weekly routine into a dated calendar

Today, an event has a weekday and clock times. It has no calendar date or time zone. The interface's “this occurrence only” means one weekday slot in a repeating routine, not one specific date. Manual overlaps are rejected; manual additions do not automatically replan anything.

Add dates, an explicit time zone, stable identities, recurring-series rules, and exceptions. Separate a task (what needs doing) from its scheduled occurrence (when it happens). Add completion status, duration, deadline, priority, available windows, and a fixed/flexible or locked setting. Clarify “only this event,” “this and following,” and “the whole series” when editing recurring events.

Tasks are a primary feature: users can rank them, estimate the time required, and optionally set deadlines. Provide Done, Defer, and Adjust remaining time actions. Completing a task moves it to a Completed section and removes unused future work sessions. Elapsed calendar time alone must not mark work complete. Begin with one block per task; follow with optional split sessions and a minimum session duration.

Preserve current routines through a versioned storage migration with a backup and an explicit starting week. Do not reinterpret every existing weekly event as a one-off. Test midnight boundaries, daylight-saving transitions, all-day events, and recurrence exceptions. This foundation can still use browser storage and GitHub Pages.

## 3. Dynamic scheduling: replan the rest of today

**Confirmed preference:** show proposed moves for the user to accept, then apply them. Provide Undo after applying.

The current scheduler already places activities in priority order around sleep and fixed commitments, respects available days, adds transition gaps, and reports activities that cannot fit. Extend this engine instead of replacing it with an AI dependency.

Initial flow:

1. User adds an interruption, marks something done, changes a duration, or chooses “Replan today.”
2. Preserve past/completed work, any in-progress work, sleep, locked tasks, and fixed appointments.
3. Find gaps in the remaining day and place flexible tasks using deadlines, priority, duration, available windows, and transition time. Prefer fewer unnecessary changes.
4. Show a before/after preview with a short reason for each move and a separate list of work that cannot fit.
5. Apply only after the user's confirmation, preserving a complete Undo snapshot.

For example, a new 2–3 PM appointment could move a flexible practice session to 3:10 PM, retain a fixed 4 PM class, and leave an optional walk unscheduled if no suitable space remains. The preview must explain each outcome. A later “What should I do now?” panel can suggest the highest-priority task that fits the available time, with Start, Done, and Defer controls.

Conflict choices should have distinct meanings:

| Choice | Behavior |
| --- | --- |
| Move flexible tasks | Reschedule eligible tasks around the new event. |
| Replace a selected event | Explicitly cancel or defer the selected occurrence; show exactly what is affected. |
| Keep both / allow overlap | Preserve both as an intentional conflict and make that conflict visible. |
| One-time / recurring | Choose whether the new event affects one date or a series; a one-time interruption must not rewrite every future week. |

Priority must never silently delete a commitment. If constraints make the requested plan impossible, explain the conflict instead of shortening tasks, moving protected events, or inventing free time. Describe the result as a suggested plan: “optimal” depends on what the user values and is not guaranteed by a simple scheduling heuristic.

Test invariants: fixed events and completed work never move; no unintended conflicts appear; tasks are not duplicated or silently lost; durations are preserved; unscheduled work is visible; applying and undoing restore the correct state; identical inputs produce consistent results.

## 4. Calendar import/export and synchronization

| Option | What it gives users | Recommended approach |
| --- | --- | --- |
| `.ics` export | Download selected events or a calendar for another app. | First integration deliverable. Specify dates, time zone, and recurrence bounds. |
| `.ics` import | Bring events into BetterDay from an exported calendar. | Follow export with a preview, duplicate detection, and clear handling of recurrence and unsupported fields. Imported commitments default to fixed. |
| Calendar subscription | Other apps display a changing BetterDay calendar through a feed URL. | Later option; read-only and refreshed on the receiving app's schedule. Needs a hosted, private, revocable feed. |
| Google Calendar connection | Read busy times and publish BetterDay events with continuing updates. | Start with existing events as protected busy blocks and a separate writable BetterDay calendar. Add full two-way edits after conflict handling is proven. |
| Apple/iCloud connection | Ongoing access to calendars stored in iCloud. | Separate feasibility spike for authentication and CalDAV. Apple Calendar displaying a Google account can already be covered by Google integration. |
| Outlook connection | Calendar access through Microsoft Graph. | Additional provider after the first connection works reliably. |

Google and Apple support `.ics` exchange, but importing a file does not keep later changes synchronized. Export is simpler than broad import compatibility. Sources: [Google import](https://support.google.com/calendar/answer/37118?hl=en-uk), [Apple import/export](https://support.apple.com/en-gb/guide/calendar/icl1023/mac).

Subscriptions are read-only and their refresh behavior makes them unsuitable for immediately propagating every dynamic schedule change. Sources: [Apple subscriptions](https://support.apple.com/guide/calendar/subscribe-to-calendars-icl1022/mac), [iPhone subscriptions](https://support.apple.com/en-gb/guide/iphone/iph3d1110d4/ios).

Google integration requires BetterDay's own OAuth application and permission from each user. Unattended sync needs secure server-side token handling and persistent sync state; public release may require verification. Two-way sync also needs provider IDs, deletion handling, recurrence exceptions, retries, and conflict resolution. Calendar-change webhooks are not user reminder notifications. Sources: [permissions](https://developers.google.com/workspace/calendar/api/auth), [server authorization](https://developers.google.com/identity/protocols/oauth2/web-server), [incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [change notifications](https://developers.google.com/workspace/calendar/api/guides/push).

Apple Calendar is an app and can display calendars from different providers. EventKit is for native Apple-platform apps, not an ordinary website. Apple documents Apple Account authorization for supported third-party apps and app-specific passwords as a fallback; whether BetterDay qualifies for the direct route needs investigation before promising one-click iCloud access. Sources: [Google calendars in Apple Calendar](https://support.google.com/calendar/answer/99358?hl=en), [EventKit](https://developer.apple.com/documentation/eventkit/accessing-the-event-store), [third-party account access](https://support.apple.com/en-us/121539), [app-specific passwords](https://support.apple.com/en-us/102654), [Outlook API](https://learn.microsoft.com/en-us/graph/outlook-calendar-concept-overview).

## 5. Event reminders

Web push can notify users while BetterDay is closed. It needs permission, a service worker, stored push subscriptions, and a backend that schedules delivery. On iPhone/iPad, users must add the web app to their Home Screen and grant permission; this is supported from iOS/iPadOS 16.4. Desktop and Android behavior depends on the browser. Sources: [Apple web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [web push overview](https://web.dev/articles/push-notifications-overview).

A timer in the current browser tab is insufficient for dependable closed-app reminders. Delivery can be delayed or prevented by connectivity and device/OS conditions, so exact-time delivery cannot be guaranteed. When an event moves, cancel its old reminder, create the replacement, and suppress expired or duplicate alerts. Calendar export offers an earlier route to using reminders in the receiving calendar app, but alert import behavior should be verified per app.

## Next dynamic-scheduling increment: wake-up adjustments

The user clarified the intent: enter usual wake-up and bedtime ranges, then adapt the day's tasks to the actual wake-up time. After the first replanning flow works, add an explicit “I'm awake” action that previews an updated plan. Preserve fixed appointments and sleep protection, and show work that cannot fit when the day starts late. Waking early can offer useful options without automatically filling every minute. Automatic sleep detection is outside the initial scope.

Use a clearly shown provisional planning time within the range; resolve the exact selection rule during implementation. Include a minimum sleep-duration safeguard. Do not interpret a bedtime range as unrestricted permission to shorten sleep or continually push it later.

## Recommended delivery order

1. Time selection and AM/PM controls, followed by a focused repeat user test.
2. Dated event model, ranked tasks with estimated effort and completion history, and preservation of existing saved routines.
3. Local “Replan today” preview, Apply, and Undo; test concrete interruptions with users.
4. Wake-up/bedtime ranges and an “I'm awake” adjustment using the same replanning engine.
5. Optional split work sessions, recurring tasks, and `.ics` export followed by import with preview and duplicate handling, prioritized by testing.
6. Accounts/cloud storage and backend jobs when the group is ready for external services; Google sync and push reminders can then proceed as separate increments.
7. Broader provider sync and richer recurring-event rules based on further testing.

The first five stages can be developed without mandatory accounts or a paid AI service. Full unattended synchronization and closed-app reminders require additional infrastructure beyond the current static site. Keep the existing GitHub Pages deployment while developing the local features; adding a backend does not itself require a frontend rewrite.

## Following product phase: habits, hobbies, and wellness

The user has identified deeper habit-building and hobby support, with wellness tied into dynamic scheduling, as the next product direction after the work discussed in this roadmap. Keep the current implementation focused on the agreed foundation. Define the later phase's concrete behavior with the user when that foundation is ready; this is recorded future intent, not an instruction to expand the present implementation.
