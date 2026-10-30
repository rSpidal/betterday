import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { blankAnswers, emptyState, loadState, saveState, STORAGE_KEY } from '../js/storage.js';
import { generateSchedule } from '../js/scheduler.js';

const originalStorage = globalThis.localStorage;
let saved;

beforeEach(() => {
  saved = new Map();
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
  };
});
afterEach(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

function completeState() {
  const answers = {
    sleep: { wake: '07:00', bed: '23:00', overrides: {} },
    commitments: [{ id: 'class', title: 'Class', days: [0, 2], start: '09:00', end: '12:00' }],
    activities: [{ id: 'study', title: 'Study', category: 'focus', duration: 60, frequency: 3, preference: 'morning', days: [0, 1, 2, 3, 4, 5, 6] }],
    challenge: 'consistent',
  };
  return { ...emptyState(), answers, schedule: generateSchedule(answers) };
}

function store(value) {
  const raw = JSON.stringify(value);
  saved.set(STORAGE_KEY, raw);
  return raw;
}

function assertRecovered(raw) {
  const result = loadState();
  assert.deepEqual(result.state, emptyState());
  assert.match(result.error, /couldn’t read your saved routine/);
  assert.equal(saved.get(STORAGE_KEY), raw, 'loading does not silently delete or overwrite recoverable source data');
}

test('an empty browser starts cleanly, and blank answers clone retained commitments', () => {
  assert.deepEqual(loadState(), { state: emptyState(), error: '' });
  const commitments = [{ id: 'a', title: 'Class', days: [0], start: '09:00', end: '10:00' }];
  const draft = blankAnswers(commitments);
  draft.commitments[0].days.push(1);
  assert.deepEqual(commitments[0].days, [0]);
  assert.deepEqual(blankAnswers(), { sleep: { wake: '', bed: '', overrides: {} }, commitments: [], activities: [], challenge: '' });
});

test('complete schedules restore, including drafts alongside the current schedule', () => {
  const state = completeState();
  state.draft = blankAnswers(state.answers.commitments);
  state.draft.activities = [{ id: 'draft', title: '', category: 'custom', duration: 0, frequency: 3, preference: 'any', days: [] }];
  state.draft.sleep.overrides[0] = { wake: '', bed: '' };
  state.draftStep = 2;
  assert.equal(saveState(state), true);
  assert.deepEqual(loadState(), { state, error: '' });
});

test('valid manual events may override preferred time and selected days', () => {
  const state = completeState();
  state.answers.activities[0].days = [0];
  state.schedule.events = [{ id: 'manual', title: 'A change of plans', day: 6, start: '18:00', end: '19:00', type: 'activity', category: 'custom', sourceId: null, preferred: true }];
  store(state);
  assert.deepEqual(loadState(), { state, error: '' });
});

test('corrupted JSON and unsupported versions recover without erasing stored data', () => {
  saved.set(STORAGE_KEY, '{broken');
  assertRecovered('{broken');
  assertRecovered(store({ ...emptyState(), version: 99 }));
});

test('a saved schedule requires complete valid answers', () => {
  for (const mutate of [
    state => { state.answers = null; },
    state => { delete state.answers.sleep; },
    state => { state.answers.activities = []; },
    state => { state.answers.sleep.wake = ''; },
    state => { state.answers.sleep.overrides[0] = null; },
  ]) {
    const state = completeState();
    mutate(state);
    assertRecovered(store(state));
  }
});

test('malformed schedule entries, notes and unplaced counts recover safely', () => {
  for (const mutate of [
    state => { state.schedule.events = [null]; },
    state => { state.schedule.events[0].day = 8; },
    state => { state.schedule.events[0].start = 'not a time'; },
    state => { state.schedule.events[0].end = state.schedule.events[0].start; },
    state => { state.schedule.events[0].type = 'unexpected'; },
    state => { state.schedule.events[0].category = 'unexpected'; },
    state => { state.schedule.events.push(structuredClone(state.schedule.events[0])); },
    state => { state.schedule.notes = [null]; },
    state => { state.schedule.unplaced = [{ activityId: 'study', title: 'Study', requested: 3, placed: -1 }]; },
    state => { state.schedule.unplaced = [null]; },
  ]) {
    const state = completeState();
    mutate(state);
    assertRecovered(store(state));
  }
});

test('incomplete drafts can restore, but malformed nested structures and step values cannot', () => {
  const draft = blankAnswers();
  draft.commitments = [{ id: 'draft-class', title: '', start: '', end: '', days: [] }];
  const state = { ...emptyState(), draft };
  store(state);
  assert.deepEqual(loadState(), { state, error: '' });
  for (const mutate of [
    value => { value.draft.commitments = [null]; },
    value => { value.draft.commitments[0].days = 'Monday'; },
    value => { value.draft.sleep.overrides = []; },
    value => { value.draft.sleep.overrides[9] = { wake: '', bed: '' }; },
    value => { value.draft.activities = [null]; },
    value => { value.draftStep = 4; },
    value => { value.draftStep = 1.5; },
  ]) {
    const invalid = structuredClone(state);
    mutate(invalid);
    assertRecovered(store(invalid));
  }
});

test('blocked storage returns a recovery notice on load and false on save', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('Storage denied'); },
    setItem: () => { throw new Error('Storage denied'); },
  };
  const result = loadState();
  assert.deepEqual(result.state, emptyState());
  assert.ok(result.error);
  assert.equal(saveState(completeState()), false);
});
