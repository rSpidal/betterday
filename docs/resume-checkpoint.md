# BetterDay local-release checkpoint

Latest review refinement (November 2): the empty commitments plus card is now fully clickable, with actionable wording, hover/focus feedback, and native Enter/Space support. Clicking the plus and keyboard activation each created exactly one commitment and focused its Name field in browser QA. The isolated 8081 origin now also has an unfinished synthetic questionnaire at the empty commitments step; its saved dated planner remains intact. Screenshot: `screenshots/commitment-card.jpg`. Changes remain local and unpublished.

Updated November 2, 2026, after the user resumed the November 1 pause. The agreed local implementation and primary browser walkthroughs are complete. All work is saved in this workspace. The user approved a local commit after review on November 2; nothing has been pushed or published.

## Product and scope

BetterDay is an active day planner: time selection → dated tasks → Preview / Apply / Undo → wake-up adjustments → split/recurring tasks and calendar-file exchange.

The user chose **Keep this release local; defer connected services**. Accounts, live Google/iCloud/Outlook sync, background notifications, and calendar subscriptions remain deferred. Habits, hobbies, and deeper wellness are the next product phase, not unfinished requirements of this release.

## Local source

- Workspace: `/Users/matteobotelho/Desktop/BetterDay`.
- Branch `main`, base `50e490dd3e5664edd88ea4cf0651de634d503b14` (October 30). Initial pull was already current; no new remote check was needed for the local resume.
- The public site has not been changed by this work.
- Main modules: `js/time-picker.js`, `js/planner.js`, `js/planner-storage.js`, `js/planner-view.js`, and `js/calendar-exchange.js`.
- Integration: `js/app.js`, `js/questionnaire.js`, `index.html`, `planner.css`, `time-picker.css`. Module/style references use the November 2 release version to avoid stale cached dependencies.
- User launcher: **Start BetterDay.command**. Double-click it to serve/open `http://127.0.0.1:8080/#schedule`; keep its Terminal window open while using the app. Closing it stops the preview. The launcher passed shell syntax validation; it was not run against the user's original-data origin during QA.

## Implemented and checked

- Visible hour/minute dropdowns and AM/PM buttons, smart one-hour ends, manual ends preserved, partial questionnaire drafts retained.
- Dated migration with original-data backup, Day/Week views, task ranking, estimates/remaining effort, optional deadlines, progress, deferral, and completion history.
- Pure proposed plans, Apply, one-step Undo, protected fixed/locked/in-progress work, and explicit unplaced-work explanations.
- Appointment conflict choices: replan flexible work on the selected date, reject, show intentional overlaps, or explicitly replace an occurrence.
- Daily/weekly appointments: edit one date or the whole series; preserved exclusions and one-date edits.
- Wake/bedtime ranges, minimum sleep, explicit actual waking and day-adjustment preview. No automatic wake detection.
- Task splitting and daily/weekly recurrence. Repeat-pattern changes retain prior completion history and protected sessions; remaining work is separate per occurrence.
- ICS snapshots, import preview/warnings/duplicate detection, simple daily/weekly recurrence/exceptions, all-day/overnight splitting, bounded atomic merge.
- JSON backup download and restore with review and Undo. Restoring a v2 planner without a v1 routine correctly updates home/navigation.
- Validated storage, recoverable previous snapshot, preservation of unreadable data, candidate-first save behavior, and a rollback journal for replacing both weekly and dated state.

## Verification

**100 automated tests passed, 0 failed**, independently rerun by root November 2 after integration. Syntax and whitespace checks are recorded in `local-release.md`.

Browser checks used synthetic data only. Completed: fresh questionnaire and dated migration; noon rollover/manual minute retention; task creation/rank/progress/defer/complete; repeat changes in both directions and preserved history; preview/apply/combined interruption Undo; fixed collision rejection, explicit overlap labels and replacement Undo; daily appointment creation, one-date edit/delete/Undo and whole-series edit; wake adjustment save/reload; ICS choose/import/reimport warning/duplicate reporting; real ICS/JSON downloads; backup review/restore; full routine replacement and persistence of custom dated events/tasks/history after reload.

At 390px and 320px, the planner/time/task flows stayed within the page. The week scrolls inside its own panel. Narrow form columns now stack to preserve readable date/select fields. Dialog transitions focus the new heading and closing returns focus to the initiating control or page heading.

Screenshots with synthetic test data: `screenshots/local-planner.jpg` and `screenshots/plan-preview.jpg`.

Not claimed: physical-device or screen-reader testing, every possible UI edge case, or importing the generated files into real Google/Apple accounts. Automated tests cover additional scheduling, DST, recurrence, storage-failure, stale-preview, and parser-limit cases.

## Saved test state and restart

- `http://127.0.0.1:8081/#schedule`: synthetic full QA plan. Last selected date Nov 6, with Write project outline work and Daily planning appointment. Prior routine replacement and task history remain saved in this browser origin.
- `http://localhost:8081/#home`: separate synthetic restored-v2-only test, no legacy routine. Its temporary test tab can be closed.
- Existing data on `http://127.0.0.1:8080` and `http://localhost:8080` was not modified for testing. Browser storage is separate for each origin; use the same address to return to the same saved plan.
- Test downloads: `/Users/matteobotelho/Downloads/betterday-calendar.ics` and `/Users/matteobotelho/Downloads/betterday-backup.json`.
- Import fixture: `/private/tmp/betterday-qa.ics`.

To resume synthetic QA from this directory:

```sh
/Users/matteobotelho/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m http.server 8081 --bind 127.0.0.1
```

Tests:

```sh
/Users/matteobotelho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.mjs
```

Check whether a server is already running before starting one. Agent-owned QA server is stopped at final handoff; use the launcher for the user's original local origin.

## Next action

Let the user try the local planning loop and repeat the original time-selection user test. Gather feedback before expanding to habits/wellness or connected services. Publication requires a later user decision. See `local-release.md` for precise release limits and remaining human/provider validation.
