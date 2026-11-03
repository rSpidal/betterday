import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlanner, saveEvent, saveTask, getEventsForDate, undoLastChange, migrateLegacy, replaceRoutine, routineCommitments, assertPlanner } from '../js/planner.js';
import { generateSchedule } from '../js/scheduler.js';
import { getCommitmentDetails, saveWeeklyCommitment, deleteCommitmentGroup, firstCommitmentDate } from '../js/commitments.js';

const DATE = '2026-11-02';
const base = () => emptyPlanner({ startDate: DATE, timeZone: 'America/New_York' });
const slots = () => [
  { id: 'mw', days: [0, 2], start: '10:00', end: '11:00' },
  { id: 'friday', days: [4], start: '10:00', end: '10:50' },
];
const create = (state = base(), overrides = {}, options) => saveWeeklyCommitment(state, { title: 'Seminar', date: DATE, slots: slots(), ...overrides }, options);
const details = state => getCommitmentDetails(state, getEventsForDate(state, DATE).find(event => event.title === 'Seminar').id, DATE);
const edit = (state, changes = {}, options) => {
  const current = details(state);
  return saveWeeklyCommitment(state, { ...current, date: DATE, ...changes }, options);
};
function legacy() {
  const answers = {
    sleep: { wake: '07:00', bed: '23:00', overrides: {} },
    commitments: [{ id: 'class', title: 'Seminar', times: slots() }],
    activities: [{ id: 'practice', title: 'Practice', category: 'hobby', duration: 30, frequency: 1, preference: 'afternoon', days: [4] }], challenge: '',
  };
  return { version: 1, answers, schedule: generateSchedule(answers), draft: null, draftStep: 0 };
}

test('one named commitment schedules separate weekday times and reopens as one group', () => {
  const original = base(), state = create(original);
  assert.equal(state.revision, original.revision + 1);
  assert.equal(state.events.length, 2);
  assert.equal(new Set(state.events.map(event => event.commitmentGroupId)).size, 1);
  for (const date of ['2026-11-02', '2026-11-04', '2026-11-09']) assert.equal(getEventsForDate(state, date)[0].end, '11:00');
  for (const date of ['2026-11-06', '2026-11-13']) assert.equal(getEventsForDate(state, date)[0].end, '10:50');
  assert.equal(getEventsForDate(state, '2026-11-03').length, 0);
  const reopened = getCommitmentDetails(state, getEventsForDate(state, '2026-11-06')[0].id, '2026-11-06');
  assert.equal(reopened.title, 'Seminar');
  assert.deepEqual(reopened.slots.map(slot => [slot.days, slot.start, slot.end]), slots().map(slot => [slot.days, slot.start, slot.end]));
  assert.deepEqual(undoLastChange(state).events, original.events);
  assertPlanner(state);
});

test('group edits rename all rows, preserve IDs, and Undo restores all rows at once', () => {
  const original = create(), current = details(original);
  const next = edit(original, { title: 'Music seminar', slots: current.slots.map(slot => ({ ...slot, start: '12:00', end: slot.end === '11:00' ? '13:00' : '12:50' })) });
  assert.deepEqual(next.events.map(event => event.id), original.events.map(event => event.id));
  assert.ok(next.events.every(event => event.title === 'Music seminar' && event.start === '12:00'));
  assert.equal(next.revision, original.revision + 1);
  assert.deepEqual(undoLastChange(next).events, original.events);
});

test('all rows may swap times without conflicting with the group being edited', () => {
  const original = create(base(), { slots: [{ days: [0], start: '10:00', end: '11:00' }, { days: [0], start: '12:00', end: '13:00' }] });
  const current = details(original);
  const next = edit(original, { slots: current.slots.map((slot, index) => ({ ...slot, start: index === 0 ? '12:00' : '10:00', end: index === 0 ? '13:00' : '11:00' })) });
  assert.equal(next.events.find(event => event.id === current.slots[0].masterIds[0]).start, '12:00');
  assert.equal(next.events.find(event => event.id === current.slots[1].masterIds[0]).start, '10:00');
});

test('legacy weekday masters combine into time rows while source identities and exceptions survive', () => {
  let original = migrateLegacy(legacy(), { startDate: DATE, timeZone: 'America/New_York' });
  const monday = original.events.find(event => event.recurrence.days[0] === 0);
  const wednesday = original.events.find(event => event.recurrence.days[0] === 2);
  monday.excludedDates = ['2026-11-09'];
  wednesday.excludedDates = ['2026-11-11'];
  for (const event of original.events) event.recurrence.until = '2026-11-30';
  monday.sourceUid = 'calendar-source'; monday.importKey = 'calendar-source:weekly';
  monday.routineSourceIds = ['previous-monday'];
  const current = details(original);
  assert.equal(current.slots.length, 2);
  assert.equal(current.slots[0].masterIds.length, 2);
  const next = edit(original, { slots: current.slots.map(slot => ({ ...slot, start: '11:00', end: slot.end === '11:00' ? '12:00' : '11:50' })) });
  assert.equal(next.events.filter(event => event.kind === 'fixed').length, 3);
  const savedMonday = next.events.find(event => event.id === monday.id), savedWednesday = next.events.find(event => event.id === wednesday.id);
  assert.equal(savedMonday.sourceUid, 'calendar-source');
  assert.equal(savedMonday.importKey, 'calendar-source:weekly');
  assert.deepEqual(savedMonday.routineSourceIds, ['previous-monday']);
  assert.deepEqual(savedMonday.excludedDates, ['2026-11-09']);
  assert.deepEqual(savedWednesday.excludedDates, ['2026-11-11']);
  assert.equal(savedMonday.recurrence.until, '2026-11-30');
  assert.equal(getEventsForDate(next, '2026-11-09').length, 0);
  assert.equal(getEventsForDate(next, '2026-11-11').length, 0);
  assert.equal(getEventsForDate(next, '2026-12-02').length, 0);
});

test('a routine started midweek still reopens matching weekday times together without moving anchors', () => {
  const original = migrateLegacy(legacy(), { startDate: '2026-11-03', timeZone: 'America/New_York' });
  const occurrence = getEventsForDate(original, '2026-11-04')[0];
  const current = getCommitmentDetails(original, occurrence.id, '2026-11-04');
  assert.equal(current.slots.length, 2);
  assert.deepEqual(current.slots[0].days, [0, 2]);
  const next = saveWeeklyCommitment(original, { ...current, date: '2026-11-04', title: 'Renamed seminar' });
  for (const event of original.events.filter(value => value.kind === 'fixed')) assert.equal(next.events.find(value => value.id === event.id).date, event.date);
  assert.equal(getEventsForDate(next, '2026-11-02').length, 0);
  assert.equal(getEventsForDate(next, '2026-11-09')[0].title, 'Renamed seminar');
});

test('new weekdays on a merged legacy row use its earliest anchor and match the preview date', () => {
  const original = migrateLegacy(legacy(), { startDate: '2026-11-03', timeZone: 'America/New_York' });
  const current = getCommitmentDetails(original, getEventsForDate(original, '2026-11-04')[0].id, '2026-11-04');
  const changedSlots = [{ ...current.slots[0], days: [3] }];
  const previewDate = firstCommitmentDate(changedSlots, '2026-11-04');
  assert.equal(previewDate, '2026-11-05');
  const next = saveWeeklyCommitment(original, { ...current, slots: changedSlots, date: previewDate });
  assert.equal(getEventsForDate(next, previewDate).find(event => event.kind === 'fixed').title, 'Seminar');
});

test('editing one date keeps group metadata without turning the exception into a repeating group', () => {
  const original = create(), occurrence = getEventsForDate(original, '2026-11-04')[0];
  const next = saveEvent(original, { ...occurrence, start: '12:00', end: '13:00' }, { scope: 'this', date: '2026-11-04' });
  const exception = getEventsForDate(next, '2026-11-04')[0];
  assert.equal(exception.recurrence, null);
  assert.equal(exception.commitmentGroupId, occurrence.commitmentGroupId);
  assert.equal(getCommitmentDetails(next, exception.id, exception.date), null);
  const editedGroup = edit(next, { title: 'Changed group' });
  assert.deepEqual(editedGroup.events.find(event => event.id === exception.id), next.events.find(event => event.id === exception.id));
  assert.equal(getEventsForDate(editedGroup, '2026-11-04').length, 1);
  assert.equal(getEventsForDate(editedGroup, '2026-11-06')[0].title, 'Changed group');
  assert.deepEqual(undoLastChange(editedGroup).events, next.events);
});

test('manual groups remain manual and survive questionnaire replacement', () => {
  const original = create();
  assert.ok(original.events.every(event => !event.id.startsWith('legacy-') && !event.routineGroupId));
  const next = replaceRoutine(original, legacy(), { startDate: DATE });
  for (const event of original.events) assert.deepEqual(next.events.find(value => value.id === event.id), event);
});

test('active questionnaire groups do not include retired generations or unrelated same-title events', () => {
  const initial = migrateLegacy(legacy(), { startDate: DATE, timeZone: 'America/New_York' });
  let next = replaceRoutine(initial, legacy(), { startDate: '2026-11-09' });
  next = saveEvent(next, { id: 'unrelated', title: 'Seminar', date: DATE, start: '14:00', end: '15:00', recurrence: { frequency: 'weekly', days: [0], until: null } });
  const selected = getEventsForDate(next, '2026-11-09').find(event => event.id.startsWith('legacy-'));
  const current = getCommitmentDetails(next, selected.id, '2026-11-09');
  assert.equal(current.masterIds.length, 3);
  assert.ok(current.masterIds.every(id => id.endsWith('-routine-1')));
  const updated = saveWeeklyCommitment(next, { ...current, title: 'Current seminar', date: '2026-11-09' });
  assert.equal(updated.events.find(event => event.id === 'unrelated').title, 'Seminar');
  for (const event of initial.events) assert.equal(updated.events.find(value => value.id === event.id).title, event.title);
});

test('new rows added to a questionnaire commitment remain part of its editable routine', () => {
  const original = migrateLegacy(legacy(), { startDate: DATE, timeZone: 'America/New_York' });
  const current = details(original);
  const next = edit(original, { slots: [...current.slots, { days: [1], start: '15:00', end: '16:00' }] });
  const added = getEventsForDate(next, '2026-11-03')[0];
  assert.ok(added.masterId.startsWith('legacy-'));
  assert.equal(added.routineGroupId, 'class');
  assert.equal(routineCommitments(next, { date: DATE })[0].times.length, 3);
  assert.equal(details(next).slots.length, 3);
});

test('standalone old weekly events become one group without grabbing same-title events', () => {
  let original = saveEvent(base(), { id: 'older', title: 'Seminar', date: DATE, start: '10:00', end: '11:00', recurrence: { frequency: 'weekly', days: [0, 2], until: '2026-11-30' }, excludedDates: ['2026-11-11'], sourceUid: 'retained-source', sourceOccurrence: 'original-occurrence' });
  original = saveEvent(original, { id: 'separate', title: 'Seminar', date: DATE, start: '15:00', end: '16:00', recurrence: 'weekly' });
  const current = getCommitmentDetails(original, 'older', DATE);
  assert.equal(current.slots.length, 1);
  const next = saveWeeklyCommitment(original, { ...current, date: DATE, slots: [...current.slots, slots()[1]] });
  const older = next.events.find(event => event.id === 'older');
  assert.equal(older.sourceUid, 'retained-source');
  assert.equal(older.sourceOccurrence, 'original-occurrence');
  assert.deepEqual(older.excludedDates, ['2026-11-11']);
  assert.equal(older.recurrence.until, '2026-11-30');
  assert.equal(next.events.find(event => event.id !== 'older' && event.id !== 'separate').recurrence.until, '2026-11-30');
  assert.deepEqual(next.events.find(event => event.id === 'separate'), original.events.find(event => event.id === 'separate'));
  assert.equal(getCommitmentDetails(next, 'older', DATE).slots.length, 2);
});

test('converting a one-off to several weekly rows retains its identity and accepts a new start date', () => {
  const original = saveEvent(base(), { id: 'one-off', title: 'Seminar', date: DATE, start: '10:00', end: '11:00', sourceUid: 'imported-source' });
  const next = create(original, { id: 'one-off', date: '2026-11-09' });
  const retained = next.events.find(event => event.id === 'one-off');
  assert.equal(retained.sourceUid, 'imported-source');
  assert.equal(retained.date, '2026-11-09');
  assert.equal(getEventsForDate(next, DATE).length, 0);
  assert.equal(getEventsForDate(next, '2026-11-09')[0].title, 'Seminar');
  assert.equal(getCommitmentDetails(next, retained.id, '2026-11-09').slots.length, 2);
});

test('changing weekdays retains identities and removing a row removes only that row', () => {
  const original = create(), current = details(original);
  const next = edit(original, { slots: [{ ...current.slots[0], days: [1, 3] }] });
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].id, current.slots[0].masterIds[0]);
  assert.equal(getEventsForDate(next, DATE).length, 0);
  assert.equal(getEventsForDate(next, '2026-11-03').length, 1);
  assert.equal(getEventsForDate(next, '2026-11-06').length, 0);
  assert.deepEqual(undoLastChange(next).events, original.events);
});

test('invalid later rows do not save valid earlier rows or modify the original state', () => {
  const original = create(), snapshot = structuredClone(original), current = details(original);
  for (const invalid of [
    { days: [], start: '12:00', end: '13:00' },
    { days: [1], start: '12:00', end: '11:00' },
    { days: [0], start: '10:30', end: '11:30' },
  ]) {
    assert.throws(() => edit(original, { slots: [current.slots[0], invalid] }, { conflict: 'allow' }));
    assert.deepEqual(original, snapshot);
  }
});

test('future conflict in a later row rejects the whole group atomically', () => {
  const original = saveEvent(base(), { id: 'exam', title: 'Exam', date: '2027-02-05', start: '10:30', end: '11:30' });
  const snapshot = structuredClone(original);
  assert.throws(() => create(original), /overlaps Exam on 2027-02-05/);
  assert.deepEqual(original, snapshot);
  assert.equal(create(original, {}, { conflict: 'allow' }).events.length, 3);
});

test('moving flexible work is allowed only on the single preview date', () => {
  let original = saveTask(base(), { id: 'task', title: 'Practice', remaining: 60, duration: 60 });
  original = saveEvent(original, { id: 'work', title: 'Practice', date: DATE, start: '10:00', end: '11:00', kind: 'session', taskId: 'task', locked: false });
  assert.equal(create(original, {}, { conflict: 'move' }).events.length, 3);
  const laterWork = saveEvent(original, { id: 'later-work', title: 'Practice', date: '2026-11-06', start: '10:00', end: '11:00', kind: 'session', taskId: 'task', locked: false });
  assert.throws(() => create(laterWork, {}, { conflict: 'move' }), /overlaps work on 2026-11-06/);
  assert.throws(() => create(original, {}, { conflict: 'move', nowMinutes: 601 }), /overlaps Practice/);
});

test('group deletion preserves separate exceptions and unrelated events, and has one Undo', () => {
  let original = create();
  const occurrence = getEventsForDate(original, '2026-11-04')[0];
  original = saveEvent(original, { ...occurrence, start: '12:00', end: '13:00' }, { scope: 'this', date: '2026-11-04' });
  original = saveEvent(original, { id: 'unrelated', title: 'Seminar', date: DATE, start: '15:00', end: '16:00', recurrence: 'weekly' });
  const current = details(original), exception = getEventsForDate(original, '2026-11-04')[0];
  const next = deleteCommitmentGroup(original, current.id, DATE);
  assert.deepEqual(new Set(next.events.map(event => event.id)), new Set(['unrelated', exception.masterId]));
  assert.equal(next.revision, original.revision + 1);
  assert.deepEqual(undoLastChange(next).events, original.events);
});

test('first actual occurrence respects all rows, anchor dates, exclusions, and recurrence bounds', () => {
  assert.equal(firstCommitmentDate(slots(), '2026-11-03'), '2026-11-04');
  assert.equal(firstCommitmentDate([{ days: [0, 2], date: DATE, excludedDates: [DATE, '2026-11-04'] }], DATE), '2026-11-09');
  assert.equal(firstCommitmentDate([{ days: [0, 2], date: DATE, until: '2026-11-06', excludedDates: [DATE, '2026-11-04'] }], DATE), null);
  assert.equal(firstCommitmentDate([{ days: [0], date: '2026-11-16' }, { days: [4], date: '2026-11-06' }], DATE), '2026-11-06');
});

test('removing the clicked expiring row keeps an active row whose preview starts after that expiration', () => {
  const original = create(base(), { slots: [
    { days: [0], start: '10:00', end: '11:00', until: '2026-11-06' },
    { days: [0], start: '12:00', end: '13:00', date: '2026-11-09' },
  ] });
  const current = details(original), remaining = [current.slots[1]];
  const date = firstCommitmentDate(remaining, DATE);
  assert.equal(date, '2026-11-09');
  const next = saveWeeklyCommitment(original, { ...current, date, sourceDate: DATE, slots: remaining });
  assert.equal(next.events.length, 1);
  assert.equal(getEventsForDate(next, date)[0].start, '12:00');
  assert.deepEqual(undoLastChange(next).events, original.events);
  const occurrenceId = getEventsForDate(original, DATE)[0].id;
  const withOccurrenceId = saveWeeklyCommitment(original, { ...current, id: occurrenceId, date, slots: remaining });
  assert.deepEqual(withOccurrenceId.events, next.events);
});

test('merged exclusions skip a date only when every applicable source skips it', () => {
  let original = saveEvent(base(), { id: 'source-a', title: 'Seminar', date: DATE, start: '10:00', end: '11:00', recurrence: 'weekly', excludedDates: [DATE, '2026-11-16'], commitmentGroupId: 'shared' });
  original = saveEvent(original, { id: 'source-b', title: 'Seminar', date: DATE, start: '10:00', end: '11:00', recurrence: 'weekly', excludedDates: ['2026-11-09', '2026-11-16'], commitmentGroupId: 'shared' }, { conflict: 'allow' });
  const current = getCommitmentDetails(original, 'source-b', DATE);
  assert.equal(current.slots.length, 1);
  assert.deepEqual(current.slots[0].excludedDates, ['2026-11-16']);
  assert.equal(firstCommitmentDate(current.slots, DATE), DATE);
  assert.equal(firstCommitmentDate(current.slots, '2026-11-09'), '2026-11-09');
  assert.equal(firstCommitmentDate(current.slots, '2026-11-16'), '2026-11-23');
  const next = saveWeeklyCommitment(original, { ...current, date: DATE, title: 'Renamed seminar' }, { conflict: 'allow' });
  assert.equal(getEventsForDate(next, DATE).length, 1);
  assert.equal(getEventsForDate(next, '2026-11-09').length, 1);
  assert.equal(getEventsForDate(next, '2026-11-16').length, 0);
});

test('malformed commitment group metadata is rejected when restoring a planner', () => {
  const state = create();
  state.events[0].commitmentGroupId = { invalid: true };
  assert.throws(() => assertPlanner(state), /invalid data/);
});
