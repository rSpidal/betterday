import { assertPlanner, migrateLegacy } from './planner.js?v=20261103.10';
import { parseCalendar, mergeCalendarEvents } from './calendar-exchange.js?v=20261102';

/** Prepare one complete, undoable import without changing memory or browser storage. */
export function prepareCalendarImport({ state = null, legacy = null, text, timeZone, startDate, endDate } = {}) {
  if (state) assertPlanner(state);
  const base = state ? structuredClone(state) : migrateLegacy(legacy, { startDate, timeZone });
  const result = parseCalendar(text, { timeZone: base.timeZone, startDate, endDate, existingEvents: base.events });
  const candidate = structuredClone(base);
  if (result.events.length) {
    candidate.events = mergeCalendarEvents(base.events, result.events).events;
    candidate.revision = base.revision + 1;
    candidate.undo = { ...structuredClone(base), undo: null };
  }
  assertPlanner(candidate);
  return { base, result, candidate };
}
