# BetterDay local release checklist

## November 2 review refinement: clickable commitment card

The empty commitments card is now a native button using the existing add-commitment action. Its title reads “Add your first commitment.” The whole card, including the plus, adds one commitment and focuses its Name input. Browser verification passed for clicking the plus, Enter, Space, and the visible keyboard focus outline; no console errors. Screenshot: [commitment card](screenshots/commitment-card.jpg). This refinement is included in the reviewed local release and remains unpublished.

Updated November 2, 2026. This records implementation and verification separately. The current changes are local and unpublished; the public GitHub Pages site remains on the October 30 weekly-routine release (`50e490d`).

## Milestones implemented in the local source

| Step | Implemented behavior | Verification status |
| --- | --- | --- |
| 1. Time selection | Hour/minute dropdowns, AM/PM buttons, one-hour end suggestions until manually changed, explicit midnight ends, and draft preservation. | Automated tests and the browser questionnaire/noon/manual-end flow pass. Further accessibility and boundary checks are listed below. |
| 2. Dated planner and tasks | Explicit start date/time zone; migration with original data retained; dated day/week views; ranked tasks, remaining effort, deadlines, and completion history. | Automated model/storage tests pass. Browser checks cover fresh setup, task transitions, retaking the questionnaire, retained history, and reload. |
| 3. Dynamic planning | Preview, Apply, Undo; one-date replanning around protected events; visible unplaced work; explicit appointment conflict choices. | Automated scheduling/transaction tests pass. Browser preview/apply, combined interruption/Undo, fixed-conflict rejection, intentional overlap, and explicit replacement/Undo pass. |
| 4. Waking and sleep | Wake/bedtime ranges, minimum-sleep validation, and “I'm awake” followed by a proposed day adjustment. | Automated sleep/window tests pass. Browser saving of ranges and actual waking survives reload. |
| 5. Task depth and calendar exchange | Optional split sessions, daily/weekly task recurrence, `.ics` snapshots with import preview and duplicate reporting. | Automated recurrence/file-exchange tests pass. Browser task repeat-pattern changes, calendar import, duplicate detection, downloads, and backup restore pass. Provider-app exchange has not been verified. |

The checks below describe the exact verified paths. Other browsers, devices, and third-party calendar applications have not all been tested.

## Automated verification completed

Run the full Node test suite with:

```sh
node --test tests/*.test.mjs
```

The final integrated run on **November 2, 2026 passed all 100 tests, with no failures**. The suite includes:

- Original routine generation, fixed commitments, sleep/day overrides, priorities, overlaps, midnight, and unavailable sessions.
- All-minute 12/24-hour conversion, noon/midnight, partial dropdown selections, automatic end suggestions, and preservation of manually selected ends.
- Migration that preserves original weekly data, generated activities, unplaced intentions, and independent day-specific sleep settings.
- Daily/weekly event occurrences, exclusions, edits to one date or a whole series, and conflict validation on later recurrence dates.
- Priority placement, splitting into useful gaps, protected/ongoing work, and avoiding duplicate reservations on another date.
- Pure previews, stale-preview rejection, apply/undo restoration, and combined interruption/replanning changes.
- Completion, partial progress, per-date recurring progress, deferral, repeat-pattern changes with history preserved, and retirement of replaced routines without falsely marking tasks complete.
- Wake ranges, actual waking, midnight, and daylight-saving clock-change boundaries.
- Storage validation, recovery from a prior valid snapshot, preservation of corrupt originals, blocked-storage reporting, and coordinated questionnaire/planner replacement with rollback after saving fails or is interrupted.
- Calendar timezone conversion, COUNT/INTERVAL/UNTIL recurrence, EXDATE, moved/cancelled instances, all-day and overnight splitting, stable identities across import date windows, dense saved calendars, atomic batch merging, nominal day durations across DST, escaping, UTF-8 folding, and malformed-input limits.

Whitespace validation (`git diff --check`) passed. The calendar-exchange module and the macOS launcher's shell syntax also passed syntax checks. The launcher itself was not executed during QA, so its double-click behavior remains to be checked. A new full test run is required after code changes that affect these behaviors.

## Browser QA completed

Checks used synthetic data on the isolated local origin `http://127.0.0.1:8081`. The user's existing `8080` data was not replaced for testing.

- [x] Fresh questionnaire → review → explicit dated migration succeeds.
- [x] Dropdown-only time entry works; 11:30 AM suggests 12:30 PM; a manually selected end/minute remains unchanged after editing the start.
- [x] Create a 90-minute task with a deadline and splitting enabled, move it down in priority, preview work sessions, and apply the proposal.
- [x] Update remaining effort from 90 to 45 minutes, then defer to November 6; its November 4 allocation is removed.
- [x] Change a one-off task to daily, retaining 40 minutes for the current date and 90 for future occurrences. Complete November 5, change to weekly starting November 6, and retain the November 5 completion. Change weekly back to one-off and retain 30 remaining minutes.
- [x] Add an appointment as an interruption, preview work moving around it, apply, and Undo. Undo removes the new appointment and restores the previous plan.
- [x] Complete a task; unused future work is removed and the task appears in Completed.
- [x] Save wake ranges and an actual wake-up time through preview/apply; reload preserves the changes.
- [x] Choose/import a synthetic `.ics` fixture: four dated blocks are offered with one unsupported monthly-recurrence warning. Reimport reports four duplicates and adds none.
- [x] Download an actual `.ics` file and a JSON backup from the browser.
- [x] Upload the JSON backup, review it, and restore the planner. Undo is offered afterward.
- [x] Restore a dated-planner-only backup on a fresh origin with no original weekly routine; Home shows “View my schedule” and the dated schedule preview.
- [x] At a 390px phone width, the planner day view and time-selection dialog have no page/dialog horizontal overflow.
- [x] At 320px, the page and week view have no page-level horizontal overflow; the week grid scrolls within its container. Task-form date and select controls stack to avoid truncation.
- [x] Create a daily appointment and edit only November 4 from 10 AM to noon–1 PM; November 5 remains at 10 AM. Reload preserves the November 4 exception.
- [x] Delete only the November 5 appointment occurrence, then Undo the deletion.
- [x] Rename the whole daily appointment series; November 5 reflects the new name and the separate November 4 exception remains intact.
- [x] Reject a fixed-appointment collision. Intentionally keep overlapping appointments and verify that both are marked in Day view. Explicitly replace an appointment, save, and Undo the replacement.
- [x] Complete all four questionnaire-retake steps with an existing class commitment and a new Movement activity. After saving and reloading, retain the custom daily appointment and November 4 exception, imported rehearsal, a 30-minute task due November 6, completed flute task, and November 5 completion history.
- [x] Check browser errors after the final integration changes: the fresh restore tab reports none, and task transitions, retaking the questionnaire, overlaps, and previews produce no new errors after the module-cache fix. Temporary missing-export errors seen while modules were being edited were resolved by versioned module/style imports.

Screenshots use synthetic QA data: [dated planner](screenshots/local-planner.jpg) and [plan preview](screenshots/plan-preview.jpg).

## Remaining browser checks and coverage limits

- [ ] Extend responsive checks to wider layouts and longer previews/import warnings.
- [ ] Check keyboard navigation, visible focus, dialog focus/close behavior, midnight/overnight error feedback, and minimum-sleep errors.
- [ ] Exercise whole-series deletion through the UI.
- [ ] Exercise restore Undo and malformed-file failure separately; verify the previous plan survives a rejected restore.
- [ ] Double-click `Start BetterDay.command` and confirm that opening and closing the local preview work as described in the README.
- [ ] Repeat the original time-entry test with users without prompting them toward the dropdowns.
- [ ] Verify actual Google Calendar and Apple Calendar import/export interoperability. Browser testing so far used synthetic calendar fixtures and BetterDay's own downloads, not connected provider accounts or the providers' import screens.

## Deliberate release boundaries

- Replanning targets one selected day. It does not optimize a whole week, automatically roll unfinished work into tomorrow, or continuously change the calendar in the background.
- Daily and weekly recurrence are supported. Appointment edit scopes are “only this date” and “the whole series”; “this and following” remains unimplemented.
- Recurring tasks track progress by date. The initial task editor changes shared task details; it is not a full recurrence-exception editor for every task property.
- The questionnaire still selects up to three initial activities. Additional dated-planner tasks are separate from that setup limit.
- Sleep ranges use latest wake-up and earliest bedtime provisionally. Waking is entered explicitly, not detected. Bedtime ranges can cross midnight when the chosen range still preserves minimum sleep.
- Imported appointments are fixed dated snapshots. Import does not update an existing event from its source calendar. Previously saved single-day source identities are recognized even when a later file moves the occurrence outside the original date range. Multi-day events are split into daily blocks. Calendar guests, notes, links, attachments, and alarms are not imported.
- File-exchange bounds are 5 MB, 366 days, and 5,000 blocks. Unsupported monthly/yearly/custom recurrence and unsafe clock-offset cases are reported.
- Data is browser-local. No accounts, cloud synchronization, live Google/iCloud/Outlook connection, calendar-feed subscription, or notification reminder is implemented.
- Backup download and upload/restore with review are available. Restoring a backup replaces the dated planner; it does not replace the current weekly questionnaire. An existing dated plan can be recovered with Undo after restoration.
- Habits, hobbies, and deeper wellness behavior remain the next product phase.

## Next validation gate

The primary local workflows have been validated and are ready for the user's review. Repeat the original time-entry user test and use the remaining checklist for broader coverage before publication. Keep this version local until the user chooses publication. External services and provider credentials are separate future setup work, not requirements for testing this local planning loop.
