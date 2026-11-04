# BetterDay

## Project Owners

- **Name:** Ryan
- **Role:** Driver

- **Name:** Triston
- **Role:** Designer

- **Name:** Matteo
- **Role:** Tester

## About BetterDay

Your better day starts now. BetterDay is an active day planner: capture commitments and tasks, preview a realistic plan, and adjust the remaining day as circumstances change. Users stay in control through Preview, Apply, and Undo.

The local release adds dated schedules, ranked tasks, completion history, sleep preferences, and calendar-file exchange to the original weekly-routine questionnaire. See the [product vision](docs/product-vision.md), [implementation roadmap](docs/user-testing-roadmap.md), and [local release checklist](docs/local-release.md).

The app uses plain HTML, CSS, and JavaScript. It needs no build step, dependency installation, account, database, API key, or external service. All planning and file exchange happen in the browser.

## Website

GitHub Pages: **https://rspidal.github.io/betterday/**

The `main` branch is published on GitHub Pages. Local edits become public only after they are committed, pushed, and the deployment finishes.

GitHub Pages publishes the root of the `main` branch. Pushing changes to `main` triggers a new deployment; the Actions tab shows its progress. The `.nojekyll` file serves the existing HTML, CSS, and JavaScript directly.

## Run locally

On this Mac, double-click **Start BetterDay.command** in the project folder. It starts the local server and opens the saved schedule at **http://127.0.0.1:8080/#schedule**. Keep the Terminal window open while using BetterDay; close it to stop the preview. If port 8080 is already in use, close the earlier preview first. The launcher uses Python 3 and does not publish the site.

Alternatively, open Terminal and run:

```sh
cd /Users/matteobotelho/Desktop/BetterDay
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080** in your browser. Press **Control+C** in Terminal to stop the server. Teammates should use the location of their own checkout in the `cd` command.

Serve the folder over HTTP rather than opening `index.html` directly, because the JavaScript uses modules. If Python is unavailable, any local static server works. Node users can also run `npm start` when Python is installed.

## Pages and behavior

- **Home:** new users can Import a calendar, Start blank, or Use questionnaire. Import opens the file chooser and review flow immediately, without requiring a saved planner. Returning users open their saved schedule.
- **Questionnaire (optional):** four steps for daily rhythm, fixed commitments, up to three initial personal activities, and review. Skip for now opens the planner while keeping unfinished answers. Completing the questionnaire later preserves manually added tasks and appointments. Time fields use visible hour/minute dropdowns and AM/PM buttons.
- **Dated planner setup:** importing a calendar is offered first; new users can also confirm their time zone and open an empty calendar, with adjustable default planning hours of 7 AM–11 PM. Users with a completed weekly routine choose its starting date before migration; the original routine is retained.
- **My schedule:** dated day/week views with previous/next week navigation across months and years, a visible week range, and a date picker for direct jumps. Day view arrows move one day. Includes commitments, flexible or locked work sessions, a ranked task list, and a Completed section. Add commitment supports one-time, daily, or weekly repeats on selected weekdays. Weekly commitments support multiple day/time rows under one name, matching the questionnaire (for example, Mon/Wed 10–11 and Fri 10–10:50). Edit only one date or the whole commitment, review all rows before saving, and Undo the complete change.
- **Sleep & wake:** set usual wake-up and bedtime ranges plus minimum sleep.
- **Calendar import:** available from Home, initial setup, and the planner toolbar. Choose an `.ics` file, a date window (90 days by default), and a time zone for a new planner. Export guidance covers Google Calendar and Apple Calendar. Review the filename, range, events, duplicate counts, and unsupported-item notes before saving. Change the file or dates without starting over; Cancel saves nothing, and Undo removes the import. Existing tasks, commitments, and questionnaire answers stay intact.
- **Calendar export:** download a dated `.ics` snapshot from Export calendar in the planner footer.
- **Edit weekly routine:** retake the questionnaire to replace the generated routine from the current date while retaining user-added tasks, appointments, and prior dated history. The keep-previous-answers option starts with saved questionnaire answers and reads the current sleep preferences and migrated commitment series, including series edits and date exclusions. Separately added appointments remain dated planner items.

The initial three-activity limit belongs to the questionnaire. Users can add additional tasks directly in the dated planner.

## Time selection

Hour and minute dropdowns plus AM/PM buttons make typing optional. New paired start/end fields suggest a one-hour duration, including transitions through noon. Selecting an end manually stops automatic changes; saved events keep their existing values. All minute values remain available, including times such as 11:52.

An end of midnight means the end of the selected date and is stored as `24:00`. Manually entered overnight appointments must be split across dates. Sleep fields have no inferred event duration.

## Tasks and dynamic planning

Tasks have a name, ranked priority, remaining minutes, optional deadline, and optional daily/weekly recurrence. Users can drag task handles or use up/down arrows to reorder priorities, update remaining effort, defer work, or mark it complete. Recurring tasks track progress and completion separately for each occurrence date. Changing a task's repeat pattern preserves recorded completion history and removes obsolete future flexible sessions; Undo can restore the change.

“Can split into shorter work sessions” lets the planner use multiple gaps while respecting the task's minimum session length. Otherwise, the task needs one uninterrupted block.

“Preview my plan” proposes work sessions for **one selected date**: the remaining part of today or a future day. The preview explains changes and shows work that cannot fit. Apply saves the proposal; Undo restores the previous state. Passing a scheduled end time never completes a task automatically. Completing a task releases unused future work sessions and records completion history.

## Scheduling rules

- Fixed appointments, locked sessions, past work, and work already underway stay anchored during replanning.
- Priority determines placement order; deadlines, eligible dates, available days, preferred windows, and existing reservations also constrain placement.
- Suggested sessions include 10-minute transition gaps. Existing suitable placements are preferred to unnecessary changes.
- Unscheduled work is reported instead of being silently discarded or shortened.
- Until actual waking is recorded, the planner uses the **latest wake-up** and **earliest bedtime** in the chosen ranges. Minimum sleep is checked against the range endpoints, including a bedtime range that crosses midnight.
- Missing or repeated daylight-saving clock hours are excluded from automatic work sessions, with an explanation.
- Appointment conflicts have explicit choices: preview moving flexible work, reject a conflict, keep both with a visible overlap, or replace a selected occurrence. A recurring appointment edit can affect **only this date** or **the whole series**. “This and following” is not implemented.

This is a deterministic, one-day planning heuristic, not a guarantee of globally optimal scheduling across a week. It does not automatically move tasks into tomorrow, detect waking, infer task completion, or continually replan in the background. Changes to future recurring appointments do not automatically replan every affected date.

## Calendar files and current limits

`.ics` files provide snapshot import/export, not live synchronization. Exports contain dated occurrences within the selected range. Imported events become fixed appointments; existing identities are skipped rather than updated from another calendar. Duplicate checks include previously saved source identities outside the selected range, so moving a single-day source occurrence to another date does not create another copy. Saved recurring calendars are indexed without consuming the incoming file's event allowance.

The importer supports UTC, IANA time zones, floating times interpreted in the planner's zone, simple daily/weekly recurrence, exclusions, and individual moved/cancelled occurrences. Multi-day and overnight events become separate daily blocks. Unsupported recurrence patterns, custom time-zone definitions, and other unsupported data are reported in the preview. Titles and times are imported; guests, attachments, descriptions, meeting links, and alarms are not.

File exchange is limited to 5 MB imports, a range of up to 366 days, and 5,000 event blocks. Ambiguous timestamps that cannot be represented safely by the local clock model are reported rather than silently changed.

Accounts, cross-device storage, Google/iCloud/Outlook connections, calendar subscriptions, and notification reminders are deferred. No calendar account is accessed. Deeper habits, hobbies, and wellness features remain the following product phase.

## Local data and backups

Data stays in the same browser, device, and origin (address and port). A schedule saved on `127.0.0.1:8080` does not appear automatically on GitHub Pages or another port. Clearing browser data removes local plans. Private browsing or storage restrictions can prevent saving; the app shows a warning.

- `betterday.v1`: original questionnaire, draft, and weekly routine.
- `betterday.v1.backup-before-planner`: original routine snapshot preserved before migration.
- `betterday.planner.v2`: dated events, tasks, progress, sleep settings, and the last undo snapshot.
- `betterday.planner.v2.backup`: previous valid saved planner.
- `betterday.planner.v2.recovery`: unreadable saved data retained when a recovered plan is subsequently saved.
- `betterday.routine-replacement.pending`: temporary recovery record used while updating both the weekly routine and dated planner.

Loading validates nested data. If possible, it recovers the previous valid planner without erasing the unreadable original. “Download backup” saves a recovery snapshot containing the planner and original routine. “Restore backup” validates an uploaded JSON file and shows a review before replacing the dated planner. The current weekly questionnaire stays unchanged. When an existing dated plan is replaced, Undo is available to return to it.

Retaking the questionnaire saves the weekly routine and dated planner together. If saving fails or is interrupted, the recovery record restores the earlier pair rather than leaving mismatched versions.

## Project files

- `index.html`, `styles.css`, `planner.css`, and `time-picker.css`: shared shell and responsive visual design.
- `js/app.js`: navigation, home, questionnaire, and planner integration.
- `js/questionnaire.js`: questionnaire steps and field interactions.
- `js/time-picker.js`: shared dropdown/AM-PM controls and smart end suggestions.
- `js/planner-view.js`: dated planner, task management, previews, and file exchange UI.
- `js/planner.js`: dated task/event model, migration, scheduling, progress, and undo.
- `js/planner-storage.js`: validated planner persistence, coordinated routine replacement, and recovery helpers.
- `js/calendar-exchange.js`: bounded, local `.ics` parsing and export.
- `js/calendar-import.js`: pure first-time/existing-planner import preparation, preserving the prior plan for Undo.
- `js/scheduler.js` and `js/storage.js`: original weekly-routine generation, validation, and storage.
- `docs/questionnaire.md`: questionnaire outline.
- `docs/local-release.md`: implemented milestones, automated verification, completed browser checks, and remaining coverage limits.
- `Start BetterDay.command`: macOS launcher for the local preview.
- `BetterdayC.pdf`: original project brief.

Storage, scheduling, and UI are separate modules so a backend can be added later.

## Tests

With a current Node.js installation:

```sh
npm test
```

No dependency installation is required. On November 4, 2026, **all 147 tests passed**. They cover the original routine and the new time controls, dated planner, migration/recovery, task progress and repeat-pattern changes, preview/apply/undo, recurrence, sleep, daylight-saving boundaries, and calendar-file exchange. Browser checks have verified the primary local planning, questionnaire-retake, calendar-file, and backup-restore workflows, including 320px and 390px layouts. See the [local release checklist](docs/local-release.md) for exact coverage and remaining validation.

Task previews allow manual start/end times and removal of individual blocks. Smart scheduling defaults to 90 minutes after the latest wake-up and before the earliest bedtime, with an override in the preview. During the wake-up range, Time before tasks opens a readiness delay control. Preview edits validate overlaps and the current clock before applying.
