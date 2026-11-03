import { addDays, assertPlanner, getEventsForDate, isDate, saveEvent } from './planner.js?v=20261103.10';
import { toMinutes } from './scheduler.js';

const copy = value => structuredClone(value);
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const weekday = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const daysFor = event => event.recurrence?.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : event.recurrence?.days || [weekday(event.date)];
const validDays = days => Array.isArray(days) && days.length > 0 && days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(days).size === days.length;
const active = (event, date) => !event.recurrence?.until || event.recurrence.until >= date;

function masterFor(state, id, date) {
  const direct = state.events.find(event => event.id === id);
  if (direct) return direct;
  const occurrenceId = String(id).match(/^(.*)@(\d{4}-\d{2}-\d{2})$/);
  if (occurrenceId && isDate(occurrenceId[2])) {
    const recurring = state.events.find(event => event.id === occurrenceId[1] && event.recurrence);
    if (recurring) return recurring;
  }
  const occurrenceDate = date || String(id).match(/@(\d{4}-\d{2}-\d{2})$/)?.[1];
  const occurrence = getEventsForDate(state, occurrenceDate).find(event => event.id === id);
  return occurrence && state.events.find(event => event.id === occurrence.masterId);
}

function mastersFor(state, master, date) {
  if (!master || master.kind !== 'fixed' || !master.recurrence || !active(master, date)) return [];
  const eligible = event => event.kind === 'fixed' && event.recurrence && active(event, date);
  if (master.commitmentGroupId) return state.events.filter(event => eligible(event) && event.commitmentGroupId === master.commitmentGroupId);
  if (master.id.startsWith('legacy-') && master.routineGroupId) {
    // Questionnaire replacements retain the group identity, but create a new generation.
    const generation = event => event.id.match(/-routine-\d+$/)?.[0] || '';
    return state.events.filter(event => eligible(event) && event.id.startsWith('legacy-') && event.routineGroupId === master.routineGroupId && generation(event) === generation(master));
  }
  return [master];
}

/** One editable weekly commitment, including all of its separate time rows. */
export function getCommitmentDetails(state, id, date) {
  const master = masterFor(state, id, date);
  date ||= String(id).match(/@(\d{4}-\d{2}-\d{2})$/)?.[1] || master?.date;
  if (!isDate(date)) return null;
  const masters = mastersFor(state, master, date);
  if (!masters.length) return null;
  const rows = [];
  for (const event of masters) {
    const days = daysFor(event);
    const slot = rows.find(row => {
      if (row.start !== event.start || row.end !== event.end || row.until !== (event.recurrence.until || null)) return false;
      const anchor = row.date < event.date ? row.date : event.date;
      // Individual weekday masters can start on different dates, even across a
      // week boundary. Merge only if the earlier anchor adds no occurrences.
      return [...row.masterIds.map(id => state.events.find(value => value.id === id)), event].every(source => {
        const first = firstCommitmentDate([{ days: daysFor(source), date: anchor }], anchor);
        return first >= source.date;
      });
    }) || { id: event.id, masterIds: [], days: [], start: event.start, end: event.end, date: event.date, until: event.recurrence.until || null, excludedDates: [] };
    if (!rows.includes(slot)) rows.push(slot);
    slot.masterIds.push(event.id);
    slot.days = [...new Set([...slot.days, ...days])].sort((a, b) => a - b);
    if (event.date < slot.date) slot.date = event.date;
    const sources = slot.masterIds.map(id => state.events.find(value => value.id === id));
    slot.excludedDates = [...new Set(sources.flatMap(source => source.excludedDates))].filter(value => {
      const applicable = sources.filter(source => value >= source.date && active(source, value) && daysFor(source).includes(weekday(value)));
      return applicable.length > 0 && applicable.every(source => source.excludedDates.includes(value));
    }).sort();
  }
  return {
    id: master.id,
    groupId: master.commitmentGroupId || (master.id.startsWith('legacy-') && master.routineGroupId ? `routine:${master.routineGroupId}:${master.id.match(/-routine-\d+$/)?.[0] || 'original'}` : null),
    title: master.title,
    date,
    masterIds: masters.map(event => event.id),
    slots: rows,
  };
}

/** Earliest actual occurrence at or after the preview date; null for an ended pattern. */
export function firstCommitmentDate(slots, startDate) {
  if (!isDate(startDate)) throw new Error('Choose a valid starting date.');
  let first = null;
  for (const slot of slots) {
    if (!validDays(slot.days)) continue;
    const start = isDate(slot.date) && slot.date > startDate ? slot.date : startDate;
    const excluded = new Set(slot.excludedDates || []);
    // Every additional full week contains a candidate unless one is explicitly excluded.
    for (let offset = 0; offset < 7 * (excluded.size + 1); offset++) {
      const date = addDays(start, offset);
      if (slot.until && date > slot.until) break;
      if (slot.days.includes(weekday(date)) && !excluded.has(date)) {
        if (!first || date < first) first = date;
        break;
      }
    }
  }
  return first;
}

function validateSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) throw new Error('Add at least one time for this commitment.');
  const normalized = slots.map(slot => {
    if (!slot || !validDays(slot.days)) throw new Error('Choose at least one day for each commitment time.');
    const start = toMinutes(slot.start), endText = slot.end === '00:00' && start > 0 ? '24:00' : slot.end, end = toMinutes(endText);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= 1440 || end > 1440 || end <= start) throw new Error('Each commitment time needs an end later than its start. Split overnight times across dates.');
    if (slot.date !== undefined && !isDate(slot.date)) throw new Error('Choose a valid starting date for each commitment time.');
    if (slot.until !== undefined && slot.until !== null && !isDate(slot.until)) throw new Error('Choose a valid ending date for each commitment time.');
    if (slot.excludedDates !== undefined && (!Array.isArray(slot.excludedDates) || !slot.excludedDates.every(isDate))) throw new Error('This commitment has an invalid skipped date.');
    return { ...copy(slot), days: [...slot.days].sort((a, b) => a - b), end: endText };
  });
  for (let a = 0; a < normalized.length; a++) for (let b = a + 1; b < normalized.length; b++) {
    const left = normalized[a], right = normalized[b];
    if (left.days.some(day => right.days.includes(day)) && toMinutes(left.start) < toMinutes(right.end) && toMinutes(left.end) > toMinutes(right.start)) throw new Error('Commitment times on the same day must not overlap.');
  }
  return normalized;
}

function finish(state, next) {
  next.revision = state.revision + 1;
  next.undo = copy(state);
  next.undo.undo = null;
  assertPlanner(next);
  return next;
}

/** Validate and save every row together. No intermediate state is stored or exposed. */
export function saveWeeklyCommitment(state, values, { conflict = 'reject', nowMinutes = 0 } = {}) {
  assertPlanner(state);
  if (!isDate(values.date)) throw new Error('Choose a valid starting date.');
  if (values.sourceDate !== undefined && !isDate(values.sourceDate)) throw new Error('The commitment opening date is invalid. Reopen it and try again.');
  const sourceDate = values.sourceDate || String(values.id).match(/@(\d{4}-\d{2}-\d{2})$/)?.[1] || values.date;
  const title = String(values.title || '').trim();
  if (!title || title.length > 500) throw new Error('Enter a commitment name of up to 500 characters.');
  const slots = validateSlots(values.slots);
  const selected = values.id ? masterFor(state, values.id, values.date) : null;
  if (values.id && (!selected || selected.kind !== 'fixed')) throw new Error('This commitment could not be found.');
  const details = selected && getCommitmentDetails(state, selected.id, sourceDate);
  if (selected?.recurrence && !details) throw new Error('This repeating commitment has already ended.');
  const originalIds = new Set(details?.masterIds || (selected ? [selected.id] : []));
  const originals = state.events.filter(event => originalIds.has(event.id));
  const groupId = details?.groupId || uid();
  const routine = originals.length > 0 && originals.every(event => event.id.startsWith('legacy-'));
  const used = new Set(), events = [];

  for (const [slotIndex, slot] of slots.entries()) {
    const previous = details?.slots.find(row => row.id === slot.id);
    const sourceIds = slot.masterIds || previous?.masterIds || (!details && selected && slotIndex === 0 ? [selected.id] : []);
    if (!Array.isArray(sourceIds) || sourceIds.some(id => !originalIds.has(id) || used.has(id)) || new Set(sourceIds).size !== sourceIds.length) throw new Error('A commitment time was repeated or no longer exists. Reopen the commitment and try again.');
    sourceIds.forEach(id => used.add(id));
    const sources = sourceIds.map(id => state.events.find(event => event.id === id));
    const oldDays = new Set(sources.flatMap(daysFor));
    const addedDays = slot.days.filter(day => !oldDays.has(day));
    if (!sources.length) {
      const date = slot.date || values.date;
      const until = slot.until === undefined ? selected?.recurrence?.until || null : slot.until;
      if (until && until < date) throw new Error('The commitment must end on or after its starting date.');
      events.push({
        id: `${routine ? 'legacy-commitment-' : ''}${uid()}`, title, date, start: slot.start, end: slot.end,
        kind: 'fixed', taskId: null, locked: true, recurrence: { frequency: 'weekly', days: slot.days, until }, excludedDates: slot.excludedDates || [], commitmentGroupId: groupId,
        ...(routine && selected.routineGroupId ? { routineGroupId: selected.routineGroupId } : {}),
      });
      continue;
    }
    // Retain source identity and exceptions per master, even when a questionnaire row has several masters.
    const earliestSource = sources.reduce((earliest, source) => source.date < earliest.date ? source : earliest);
    sources.forEach(source => {
      const days = [...new Set([...daysFor(source).filter(day => slot.days.includes(day)), ...(source === earliestSource ? addedDays : [])])].sort((a, b) => a - b);
      if (!days.length) return;
      events.push({ ...copy(source), title, date: source.recurrence ? source.date : slot.date || values.date, start: slot.start, end: slot.end, commitmentGroupId: groupId, recurrence: { frequency: 'weekly', days, until: source.recurrence?.until || null } });
    });
  }
  if (!events.length) throw new Error('Add at least one time for this commitment.');
  let next = copy(state);
  next.events = next.events.filter(event => !originalIds.has(event.id));
  next.undo = null;
  for (const event of events) {
    // A temporary master lets saveEvent keep the true recurrence anchor while its
    // planning date stays the single date the caller will preview and replan.
    const seeded = { ...next, events: [...next.events, event] };
    next = saveEvent(seeded, { ...event, date: values.date }, { scope: 'all', date: values.date, conflict, nowMinutes });
  }
  return finish(state, next);
}

/** Delete the repeating masters together; separately edited one-date exceptions remain. */
export function deleteCommitmentGroup(state, id, date) {
  assertPlanner(state);
  const details = getCommitmentDetails(state, id, date);
  if (!details) throw new Error('This repeating commitment could not be found.');
  const ids = new Set(details.masterIds), next = copy(state);
  next.events = next.events.filter(event => !ids.has(event.id));
  return finish(state, next);
}
