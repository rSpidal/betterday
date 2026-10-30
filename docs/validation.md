# First-version validation

Checked October 30, 2026.

## Automated

18 Node tests pass for the scheduling engine and local storage. Coverage includes sleep, day-specific overrides, midnight, fixed commitments, overlaps, activity priorities, preferred-time fallback, unavailable sessions, transition gaps, event edits, and malformed or blocked browser storage.

## Browser checks

Verified in the local browser:

- Home to all four questionnaire steps to a generated schedule.
- Repeating fixed commitments and multiple personal activities.
- Activity durations and preferred time windows.
- Event name and time edits persist after refreshing.
- Overlapping manual events are rejected with a useful message.
- Adding and deleting individual events.
- Returning home after generation changes the main button to View my schedule.
- Restarting with commitments preserves edited commitment names, times, and days.
- Restarting without commitments produces an empty commitments step.
- The existing schedule stays available while a replacement questionnaire is incomplete.
- Unfinished questionnaire answers and custom activity durations survive refreshing.
- At a 390px phone breakpoint, the schedule opens in day view and the questionnaire does not cause horizontal page overflow.
- No browser console errors during these checks.

This is a browser-only prototype for a repeating week. Accounts, cross-device saving, calendar imports, and date-specific events are not implemented.
