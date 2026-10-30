import { toMinutes, validateAnswers } from './scheduler.js';

export const STORAGE_KEY = 'betterday.v1';

const ACTIVITY_CATEGORIES = new Set(['focus', 'movement', 'hobby', 'rest', 'custom']);
const PREFERENCES = new Set(['any', 'morning', 'afternoon', 'evening']);
const CHALLENGES = new Set(['', 'busy', 'consistent', 'rest']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const identifier = value => text(value) && value.length > 0;
const day = value => Number.isInteger(value) && value >= 0 && value <= 6;
const days = value => Array.isArray(value) && value.every(day) && new Set(value).size === value.length;
const uniqueIds = entries => new Set(entries.map(entry => entry.id)).size === entries.length;

function safeSleep(value) {
  return record(value) && text(value.wake) && text(value.bed) && record(value.overrides)
    && Object.entries(value.overrides).every(([key, times]) => /^[0-6]$/.test(key)
      && record(times) && text(times.wake) && text(times.bed));
}

/** Draft values may be unfinished, but their structure must be safe to render. */
function safeAnswers(value) {
  return record(value) && safeSleep(value.sleep) && CHALLENGES.has(value.challenge)
    && Array.isArray(value.commitments) && value.commitments.every(entry => record(entry)
      && identifier(entry.id) && text(entry.title) && days(entry.days) && text(entry.start) && text(entry.end))
    && uniqueIds(value.commitments)
    && Array.isArray(value.activities) && value.activities.length <= 3 && value.activities.every(entry => record(entry)
      && identifier(entry.id) && text(entry.title) && ACTIVITY_CATEGORIES.has(entry.category)
      && typeof entry.duration === 'number' && Number.isFinite(entry.duration)
      && Number.isInteger(entry.frequency) && entry.frequency >= 1 && entry.frequency <= 7
      && PREFERENCES.has(entry.preference) && days(entry.days))
    && uniqueIds(value.activities);
}

function safeEvent(value) {
  if (!record(value) || !identifier(value.id) || !text(value.title) || !value.title.trim() || !day(value.day)
    || typeof value.preferred !== 'boolean' || !(value.sourceId === null || identifier(value.sourceId))) return false;
  if (value.type === 'commitment' ? value.category !== 'commitment'
    : value.type !== 'activity' || !ACTIVITY_CATEGORIES.has(value.category)) return false;
  const start = toMinutes(value.start);
  const end = toMinutes(value.end);
  return Number.isFinite(start) && start >= 0 && start < 1440 && Number.isFinite(end) && end <= 1440 && end > start;
}

function safeSchedule(value) {
  return record(value) && Array.isArray(value.events) && value.events.every(safeEvent) && uniqueIds(value.events)
    && Array.isArray(value.notes) && value.notes.every(text)
    && Array.isArray(value.unplaced) && value.unplaced.every(entry => record(entry)
      && identifier(entry.activityId) && text(entry.title)
      && Number.isInteger(entry.requested) && entry.requested >= 1 && entry.requested <= 7
      && Number.isInteger(entry.placed) && entry.placed >= 0 && entry.placed < entry.requested);
}

export function blankAnswers(commitments = []) {
  return {
    sleep: { wake: '', bed: '', overrides: {} },
    commitments: structuredClone(commitments),
    activities: [],
    challenge: '',
  };
}

export function emptyState() {
  return { version: 1, answers: null, schedule: null, draft: null, draftStep: 0 };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: emptyState(), error: '' };
    const parsed = JSON.parse(raw);
    if (!record(parsed) || parsed.version !== 1) throw new Error('Invalid saved data');
    const state = { ...emptyState(), ...parsed };
    if (!Number.isInteger(state.draftStep) || state.draftStep < 0 || state.draftStep > 3
      || (state.answers !== null && (!safeAnswers(state.answers) || validateAnswers(state.answers).length > 0))
      || (state.draft !== null && !safeAnswers(state.draft))
      || (state.schedule !== null && (state.answers === null || !safeSchedule(state.schedule)))) {
      throw new Error('Invalid saved data');
    }
    return { state, error: '' };
  } catch {
    return { state: emptyState(), error: 'We couldn’t read your saved routine. You can still create a schedule; saving may be unavailable in this browser.' };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
