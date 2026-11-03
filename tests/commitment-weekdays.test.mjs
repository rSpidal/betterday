import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlanner, saveEvent, getEventsForDate, undoLastChange } from '../js/planner.js';

const base = () => emptyPlanner({ startDate: '2026-11-02', timeZone: 'America/New_York' });
const commitment = (state, values = {}) => saveEvent(state, {
  id: 'seminar', title: 'Seminar', date: '2026-11-02', start: '10:00', end: '11:00',
  recurrence: { frequency: 'weekly', days: [0, 2, 4], until: '2026-11-30' },
  excludedDates: ['2026-11-11'], ...values,
});

test('selected weekdays begin on or after the chosen date without adding an unselected weekday', () => {
  const state = commitment(base(), { date: '2026-11-03' });
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-07', '2026-11-08']) {
    assert.equal(getEventsForDate(state, date).length, 0, date);
  }
  for (const date of ['2026-11-04', '2026-11-06', '2026-11-09']) {
    assert.equal(getEventsForDate(state, date).length, 1, date);
  }
});

test('editing a reopened occurrence for the whole series preserves all weekdays, the end date, and exclusions', () => {
  const original = commitment(base());
  const reopened = getEventsForDate(original, '2026-11-04')[0];
  assert.deepEqual(reopened.recurrence.days, [0, 2, 4]);
  const updated = saveEvent(original, { ...reopened, title: 'Updated seminar', start: '11:00', end: '12:00' }, {
    date: '2026-11-04', scope: 'all',
  });
  assert.equal(updated.events[0].date, '2026-11-02');
  assert.deepEqual(updated.events[0].recurrence, original.events[0].recurrence);
  assert.deepEqual(updated.events[0].excludedDates, ['2026-11-11']);
  for (const date of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-30']) {
    const occurrence = getEventsForDate(updated, date)[0];
    assert.equal(occurrence.title, 'Updated seminar', date);
    assert.equal(occurrence.start, '11:00', date);
  }
  assert.equal(getEventsForDate(updated, '2026-11-11').length, 0);
  assert.equal(getEventsForDate(updated, '2026-12-02').length, 0);
  assert.deepEqual(undoLastChange(updated).events, original.events);
});

test('changing a whole series to different weekdays updates its pattern and Undo restores the old pattern', () => {
  const original = commitment(base());
  const reopened = getEventsForDate(original, '2026-11-04')[0];
  const updated = saveEvent(original, { ...reopened, recurrence: { ...reopened.recurrence, days: [1, 3] } }, {
    date: '2026-11-04', scope: 'all',
  });
  assert.equal(updated.events[0].date, '2026-11-02');
  assert.equal(updated.events[0].recurrence.until, '2026-11-30');
  assert.deepEqual(updated.events[0].excludedDates, ['2026-11-11']);
  for (const date of ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12']) {
    assert.equal(getEventsForDate(updated, date).length, 1, date);
  }
  for (const date of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-12-01']) {
    assert.equal(getEventsForDate(updated, date).length, 0, date);
  }
  assert.deepEqual(undoLastChange(updated).events, original.events);
});

test('editing only one date creates an exception without changing the weekly pattern', () => {
  const original = commitment(base());
  const occurrence = getEventsForDate(original, '2026-11-04')[0];
  const updated = saveEvent(original, { ...occurrence, title: 'Later seminar', start: '12:00', end: '13:00' }, {
    date: '2026-11-04', scope: 'this',
  });
  const changedDate = getEventsForDate(updated, '2026-11-04');
  assert.equal(changedDate.length, 1);
  assert.equal(changedDate[0].recurrence, null);
  assert.equal(changedDate[0].start, '12:00');
  const series = updated.events.find(event => event.id === 'seminar');
  assert.deepEqual(series.recurrence, original.events[0].recurrence);
  assert.deepEqual(series.excludedDates, ['2026-11-11', '2026-11-04']);
  for (const date of ['2026-11-02', '2026-11-06', '2026-11-18']) {
    assert.equal(getEventsForDate(updated, date)[0].start, '10:00', date);
  }
  assert.equal(getEventsForDate(updated, '2026-11-11').length, 0);
  assert.deepEqual(undoLastChange(updated).events, original.events);
});

test('a multi-weekday commitment checks conflicts on later selected weekdays', () => {
  const original = saveEvent(base(), { id: 'exam', title: 'Exam', date: '2026-11-13', start: '10:30', end: '11:30' });
  const snapshot = structuredClone(original);
  assert.throws(() => commitment(original, { date: '2026-11-03' }), /overlaps Exam on 2026-11-13/);
  assert.deepEqual(original, snapshot);
});

test('a weekly commitment requires at least one selected weekday', () => {
  assert.throws(() => commitment(base(), { recurrence: { frequency: 'weekly', days: [], until: null } }), /Enter a name, valid date/);
});
