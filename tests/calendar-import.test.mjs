import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCalendarImport } from '../js/calendar-import.js';
import { emptyPlanner, saveTask, saveEvent, updateTaskRemaining, completeTask, undoLastChange, migrateLegacy } from '../js/planner.js';
import { generateSchedule } from '../js/scheduler.js';

const options = { timeZone: 'America/New_York', startDate: '2026-11-02', endDate: '2026-11-30' };
const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:import-rehearsal\r\nDTSTART:20261103T150000Z\r\nDTEND:20261103T160000Z\r\nSUMMARY:Rehearsal\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const blank = () => emptyPlanner(options);
function routine() {
  const answers = {
    sleep: { wake: '08:00', bed: '23:00', overrides: {} },
    commitments: [{ id: 'class', title: 'Class', times: [{ id: 'class-time', days: [0, 2], start: '09:00', end: '10:00' }] }],
    activities: [{ id: 'practice', title: 'Practice', category: 'hobby', duration: 30, frequency: 2, preference: 'afternoon', days: [0, 2, 4] }],
    challenge: '',
  };
  return { version: 1, answers, schedule: generateSchedule(answers), draft: null, draftStep: 0 };
}

test('first import prepares a dated planner and Undo removes the imported commitments', () => {
  const { base, result, candidate } = prepareCalendarImport({ ...options, text });
  assert.deepEqual(base, blank());
  assert.equal(result.events.length, 1);
  assert.equal(candidate.events[0].start, '10:00');
  assert.equal(candidate.events[0].kind, 'fixed');
  assert.equal(candidate.revision, 1);
  assert.deepEqual(candidate.undo, base);
  assert.deepEqual(undoLastChange(candidate).events, []);
  candidate.sleep.wake = '09:00';
  assert.equal(base.sleep.wake, '07:00', 'candidate editing cannot change its review baseline');
});

test('import-first leaves incomplete questionnaire answers intact and does not use them as a routine', () => {
  const legacy = routine();
  legacy.draft = legacy.answers;
  legacy.answers = null;
  legacy.schedule = null;
  legacy.draftStep = 2;
  const original = structuredClone(legacy);
  const { candidate, base } = prepareCalendarImport({ ...options, text, legacy });
  assert.deepEqual(legacy, original);
  assert.deepEqual(base, blank());
  assert.equal(candidate.events.length, 1);
  assert.equal(candidate.tasks.length, 0);
  assert.equal(candidate.migratedFrom, undefined);
});

test('a completed questionnaire migrates together with the import and survives Undo', () => {
  const legacy = routine(), original = structuredClone(legacy);
  const expected = migrateLegacy(legacy, options);
  const { candidate, base } = prepareCalendarImport({ ...options, text, legacy });
  assert.deepEqual(base, expected);
  assert.deepEqual(candidate.events.slice(0, expected.events.length), expected.events);
  assert.deepEqual(candidate.tasks, expected.tasks);
  assert.equal(candidate.events.length, expected.events.length + 1);
  assert.deepEqual(undoLastChange(candidate).events, expected.events);
  assert.deepEqual(legacy, original);
});

test('existing plans retain tasks, progress, completion, sleep, and overlapping manual events', () => {
  let state = saveTask(blank(), { id: 'practice', title: 'Practice', remaining: 60, duration: 60 });
  state = updateTaskRemaining(state, 'practice', 25, { date: options.startDate });
  state = saveTask(state, { id: 'done', title: 'Finished task', remaining: 15, duration: 15 });
  state = completeTask(state, 'done', { date: options.startDate, nowMinutes: 0 });
  state = saveEvent(state, { id: 'manual', title: 'Existing commitment', date: '2026-11-03', start: '10:00', end: '11:00' });
  const original = structuredClone(state);
  const { candidate, base } = prepareCalendarImport({ ...options, text, state, legacy: routine(), timeZone: 'Europe/London' });
  assert.deepEqual(state, original);
  assert.deepEqual(base, original);
  assert.equal(candidate.timeZone, 'America/New_York', 'existing planner time zone wins');
  assert.deepEqual(candidate.tasks, original.tasks);
  assert.deepEqual(candidate.sleep, original.sleep);
  assert.equal(candidate.events.length, 2, 'intentional import overlaps stay visible');
  const undone = undoLastChange(candidate);
  assert.deepEqual(undone.events, original.events);
  assert.deepEqual(undone.tasks, original.tasks);
  assert.equal(candidate.undo.undo, null, 'one Undo restores the entire pre-import plan');
});

test('duplicate-only and out-of-range imports do not consume the existing Undo', () => {
  const first = prepareCalendarImport({ ...options, text }).candidate;
  const duplicate = prepareCalendarImport({ ...options, text, state: first });
  assert.equal(duplicate.result.events.length, 0);
  assert.equal(duplicate.result.duplicateCount, 1);
  assert.deepEqual(duplicate.candidate, first);
  const outside = prepareCalendarImport({ ...options, startDate: '2026-12-01', endDate: '2026-12-31', text, state: first });
  assert.equal(outside.result.events.length, 0);
  assert.deepEqual(outside.candidate, first);
});

test('failed import leaves both an existing planner and questionnaire unchanged', () => {
  const state = blank(), legacy = routine();
  const originalState = structuredClone(state), originalLegacy = structuredClone(legacy);
  for (const invalid of [
    { text: 'not a calendar' },
    { startDate: '2026-02-30' },
    { endDate: '2028-01-01' },
    { text: 'x'.repeat(5 * 1024 * 1024 + 1) },
  ]) assert.throws(() => prepareCalendarImport({ ...options, text, state, legacy, ...invalid }));
  assert.deepEqual(state, originalState);
  assert.deepEqual(legacy, originalLegacy);
  assert.throws(() => prepareCalendarImport({ ...options, text, timeZone: 'Invalid/Zone' }), /time zone/);
});
