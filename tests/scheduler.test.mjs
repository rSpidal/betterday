import test from 'node:test';
import assert from 'node:assert/strict';
import { DAYS, toMinutes, formatTime, validateAnswers, generateSchedule, validateEvent } from '../js/scheduler.js';

function fixture() {
  return {
    sleep: { wake: '07:00', bed: '23:00', overrides: {} },
    commitments: [],
    activities: [{ id: 'study', title: 'Study', category: 'focus', duration: 60, frequency: 3, preference: 'morning', days: [0, 1, 2, 3, 4, 5, 6] }],
    challenge: '',
  };
}

test('clock utilities handle midnight and reject malformed times', () => {
  assert.equal(DAYS[0], 'Monday');
  assert.equal(toMinutes('24:00'), 1440);
  assert.equal(formatTime('00:00'), '12:00 AM');
  assert.equal(formatTime(780), '1:00 PM');
  assert.ok(Number.isNaN(toMinutes('12:60')));
  assert.ok(Number.isNaN(toMinutes('24:01')));
  assert.ok(Number.isNaN(toMinutes('7:00')));
});

test('questionnaire errors identify their step and allow incomplete drafts', () => {
  assert.deepEqual([...new Set(validateAnswers({}).map(error => error.step))], [0, 1, 2]);
  assert.deepEqual(validateAnswers(fixture()), []);
  const answers = fixture();
  answers.activities[0].duration = -20;
  answers.activities[0].days = [];
  assert.equal(validateAnswers(answers).filter(error => error.step === 2).length, 2);
  assert.throws(() => generateSchedule(answers), /duration/);
});

test('fixed commitments retain their times and repetitions; activities spread over days', () => {
  const answers = fixture();
  answers.commitments = [{ id: 'class', title: 'Class', days: [0, 2], start: '09:00', end: '12:00' }];
  const result = generateSchedule(answers);
  const fixed = result.events.filter(event => event.type === 'commitment');
  assert.equal(fixed.length, 2);
  assert.ok(fixed.every(event => event.start === '09:00' && event.end === '12:00'));
  const study = result.events.filter(event => event.type === 'activity');
  assert.equal(study.length, 3);
  assert.equal(new Set(study.map(event => event.day)).size, 3);
  assert.ok(study.every(event => toMinutes(event.end) - toMinutes(event.start) === 60));
  assert.deepEqual(result.unplaced, []);
});

test('overlapping commitments, overnight commitments, and sleep conflicts are rejected', () => {
  const answers = fixture();
  answers.commitments = [
    { id: 'a', title: 'Class', days: [0], start: '09:00', end: '11:00' },
    { id: 'b', title: 'Work', days: [0], start: '10:00', end: '12:00' },
  ];
  assert.ok(validateAnswers(answers).some(error => /overlaps Class/.test(error.message)));
  answers.commitments = [{ title: 'Overnight shift', days: [0], start: '22:00', end: '02:00' }];
  assert.ok(validateAnswers(answers).some(error => /Split overnight/.test(error.message)));
  answers.commitments = [{ title: 'Early class', days: [0], start: '06:00', end: '08:00' }];
  assert.ok(validateAnswers(answers).some(error => /sleep time/.test(error.message)));
});

test('generation honors sleep, day-specific sleep, strict available days and transition gaps', () => {
  const answers = fixture();
  answers.sleep.overrides[0] = { wake: '10:00', bed: '14:00' };
  answers.commitments = [{ id: 'lunch', title: 'Lunch', days: [0], start: '11:00', end: '12:00' }];
  answers.activities[0] = { ...answers.activities[0], duration: 50, frequency: 2, days: [0], preference: 'any' };
  const result = generateSchedule(answers);
  const activities = result.events.filter(event => event.type === 'activity');
  assert.equal(activities.length, 2);
  assert.ok(activities.every(event => event.day === 0 && toMinutes(event.start) >= 600 && toMinutes(event.end) <= 840));
  for (let index = 1; index < result.events.length; index += 1) {
    assert.ok(toMinutes(result.events[index].start) - toMinutes(result.events[index - 1].end) >= 10);
  }
});

test('priority is respected and impossible sessions are reported without shortening', () => {
  const answers = fixture();
  answers.sleep = { wake: '09:00', bed: '10:00', overrides: {} };
  answers.activities = [
    { ...answers.activities[0], title: 'Priority', duration: 60, frequency: 2, days: [0] },
    { ...answers.activities[0], id: 'walk', title: 'Walk', category: 'movement', duration: 30, frequency: 1, days: [0] },
  ];
  const result = generateSchedule(answers);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Priority');
  assert.equal(result.events[0].start, '09:00');
  assert.equal(result.events[0].end, '10:00');
  assert.deepEqual(result.unplaced.map(item => [item.title, item.requested, item.placed]), [['Priority', 2, 1], ['Walk', 1, 0]]);
});

test('fallback outside a preferred window is explicit', () => {
  const answers = fixture();
  answers.sleep = { wake: '14:00', bed: '22:00', overrides: {} };
  answers.activities[0].frequency = 1;
  const result = generateSchedule(answers);
  assert.equal(result.events[0].preferred, false);
  assert.equal(result.events[0].start, '14:00');
  assert.match(result.notes[0], /outside your preferred morning window/);
});

test('awake time across midnight and midnight end are supported', () => {
  const answers = fixture();
  answers.sleep = { wake: '21:00', bed: '09:00', overrides: {} };
  answers.activities[0] = { ...answers.activities[0], duration: 180, frequency: 1, days: [0], preference: 'evening' };
  const result = generateSchedule(answers);
  assert.equal(result.events[0].start, '21:00');
  assert.equal(result.events[0].end, '24:00');
  assert.equal(validateEvent({ title: 'Night', day: 0, start: '23:00', end: '24:00' }, [], answers), '');
  assert.match(validateEvent({ title: 'Sleep conflict', day: 0, start: '10:00', end: '11:00' }, [], answers), /sleep/);
});

test('event edits exclude themselves, reject collisions, allow adjacent manual events', () => {
  const answers = fixture();
  const existing = [{ id: 'a', title: 'Class', day: 0, start: '09:00', end: '10:00' }];
  assert.equal(validateEvent(existing[0], existing, answers, { excludeId: 'a' }), '');
  assert.match(validateEvent({ title: 'Walk', day: 0, start: '09:30', end: '10:30' }, existing, answers), /overlaps Class/);
  assert.equal(validateEvent({ title: 'Walk', day: 0, start: '10:00', end: '10:30' }, existing, answers), '');
  assert.match(validateEvent({ title: 'Walk', day: 0, start: '23:00', end: '24:00' }, existing, answers), /sleep/);
  assert.match(validateEvent({ title: '', day: 0, start: '10:00', end: '10:30' }, existing, answers), /name/);
});

test('generated weeks stay collision-free across varied durations and availability', () => {
  for (const duration of [15, 30, 45, 90, 180, 600]) {
    const answers = fixture();
    answers.commitments = [{ id: 'work', title: 'Work', days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' }];
    answers.activities = [
      { ...answers.activities[0], frequency: 7, duration },
      { ...answers.activities[0], id: 'walk', title: 'Walk', category: 'movement', frequency: 7, duration: 30, preference: 'evening' },
    ];
    const result = generateSchedule(answers);
    for (const event of result.events) assert.equal(validateEvent(event, result.events, answers, { excludeId: event.id }), '');
    for (const activity of answers.activities) {
      const placed = result.events.filter(event => event.sourceId === activity.id).length;
      assert.ok(placed <= activity.frequency);
      if (placed < activity.frequency) assert.equal(result.unplaced.find(item => item.activityId === activity.id).placed, placed);
    }
  }
});
