/** Pure, local scheduling logic. Days use Monday = 0 through Sunday = 6. */
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DAY_END = 1440;
const TRANSITION = 10;
const PREFERENCES = {
  any: [0, DAY_END],
  morning: [360, 720],
  afternoon: [720, 1020],
  evening: [1020, DAY_END],
};
const CATEGORIES = new Set(['focus', 'movement', 'hobby', 'rest', 'custom']);

export function toMinutes(time) {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  const [hours, minutes] = time.split(':').map(Number);
  if (hours === 24 && minutes === 0) return DAY_END;
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : NaN;
}

export function formatTime(value) {
  const minutes = typeof value === 'string' ? toMinutes(value) : value;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > DAY_END) return '';
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function validDays(days) {
  return Array.isArray(days) && days.length > 0 && days.every(day => Number.isInteger(day) && day >= 0 && day < 7)
    && new Set(days).size === days.length;
}

function sleepFor(answers, day) {
  return answers?.sleep?.overrides?.[day] || answers?.sleep;
}

function validSleep(sleep) {
  const wake = toMinutes(sleep?.wake);
  const bed = toMinutes(sleep?.bed);
  return Number.isFinite(wake) && wake < DAY_END && Number.isFinite(bed) && bed < DAY_END && wake !== bed;
}

function awakeWindows(answers, day) {
  const sleep = sleepFor(answers, day);
  if (!validSleep(sleep)) return [];
  const wake = toMinutes(sleep.wake);
  const bed = toMinutes(sleep.bed);
  return wake < bed ? [[wake, bed]] : [[0, bed], [wake, DAY_END]].filter(([start, end]) => end > start);
}

function withinAwake(start, end, answers, day) {
  return awakeWindows(answers, day).some(([wake, bed]) => start >= wake && end <= bed);
}

function intervalError(start, end) {
  if (!Number.isFinite(start) || start < 0 || start >= DAY_END || !Number.isFinite(end) || end <= 0 || end > DAY_END) {
    return 'Enter a valid start and end time.';
  }
  if (end <= start) return 'End time must be later than start time. Split overnight events into separate days.';
  return '';
}

/** Validate all questionnaire steps without throwing, including incomplete drafts. */
export function validateAnswers(answers) {
  const errors = [];
  if (!validSleep(answers?.sleep)) {
    errors.push({ step: 0, message: 'Enter a wake-up time and a different bedtime for your usual day.' });
  }
  const overrides = answers?.sleep?.overrides;
  if (overrides && (typeof overrides !== 'object' || Array.isArray(overrides))) {
    errors.push({ step: 0, message: 'Check your day-specific wake-up and bedtimes.' });
  } else {
    Object.entries(overrides || {}).forEach(([day, value]) => {
      if (!/^[0-6]$/.test(day) || !validSleep(value)) {
        errors.push({ step: 0, message: `Check the wake-up time and bedtime${DAYS[Number(day)] ? ` for ${DAYS[Number(day)]}` : ' for each day'}.` });
      }
    });
  }

  const commitments = answers?.commitments;
  if (!Array.isArray(commitments)) {
    errors.push({ step: 1, message: 'Review your commitments, or continue without adding any.' });
  } else {
    const occupied = Array.from({ length: 7 }, () => []);
    commitments.forEach((entry, index) => {
      const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
      const label = title || `Commitment ${index + 1}`;
      if (!title) errors.push({ step: 1, message: `Give commitment ${index + 1} a name.` });
      if (!validDays(entry?.days)) errors.push({ step: 1, message: `Choose at least one day for ${label}.` });
      const start = toMinutes(entry?.start);
      const end = toMinutes(entry?.end);
      const error = intervalError(start, end);
      if (error) errors.push({ step: 1, message: `${label}: ${error}` });
      if (!validDays(entry?.days) || error) return;
      entry.days.forEach(day => {
        if (validSleep(sleepFor(answers, day)) && !withinAwake(start, end, answers, day)) {
          errors.push({ step: 1, message: `${label} falls during your sleep time on ${DAYS[day]}. Adjust the commitment or your sleep times.` });
        }
        occupied[day].forEach(other => {
          if (start < other.end && end > other.start) {
            errors.push({ step: 1, message: `${label} overlaps ${other.title} on ${DAYS[day]}. Adjust one of these commitments.` });
          }
        });
        occupied[day].push({ title: label, start, end });
      });
    });
  }

  const activities = answers?.activities;
  if (!Array.isArray(activities) || activities.length === 0) {
    errors.push({ step: 2, message: 'Choose at least one activity you would like to make time for.' });
  } else {
    if (activities.length > 3) errors.push({ step: 2, message: 'Choose up to three activities to start.' });
    activities.forEach((activity, index) => {
      const title = typeof activity?.title === 'string' ? activity.title.trim() : '';
      const label = title || `Activity ${index + 1}`;
      if (!title) errors.push({ step: 2, message: `Give activity ${index + 1} a name.` });
      if (!Number.isInteger(activity?.duration) || activity.duration < 1 || activity.duration > DAY_END) {
        errors.push({ step: 2, message: `Choose a duration between 1 and 1,440 minutes for ${label}.` });
      }
      if (!Number.isInteger(activity?.frequency) || activity.frequency < 1 || activity.frequency > 7) {
        errors.push({ step: 2, message: `Choose 1 to 7 sessions per week for ${label}.` });
      }
      if (!validDays(activity?.days)) errors.push({ step: 2, message: `Choose at least one available day for ${label}.` });
      if (!Object.hasOwn(PREFERENCES, activity?.preference)) errors.push({ step: 2, message: `Choose a time preference for ${label}.` });
      if (!CATEGORIES.has(activity?.category)) errors.push({ step: 2, message: `Choose an activity type for ${label}.` });
    });
  }
  return errors;
}

function openGaps(answers, day, events) {
  const obstacles = events.filter(event => event.day === day)
    .map(event => [toMinutes(event.start) - TRANSITION, toMinutes(event.end) + TRANSITION])
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  awakeWindows(answers, day).forEach(([start, end]) => {
    let cursor = start;
    obstacles.forEach(([left, right]) => {
      if (right <= cursor || left >= end) return;
      if (left > cursor) gaps.push([cursor, Math.min(left, end)]);
      cursor = Math.max(cursor, right);
    });
    if (cursor < end) gaps.push([cursor, end]);
  });
  return gaps;
}

function firstSlot(gaps, duration, [windowStart, windowEnd]) {
  for (const [start, end] of gaps) {
    const candidate = Math.max(start, windowStart);
    if (candidate + duration <= Math.min(end, windowEnd)) return candidate;
  }
  return null;
}

/** Build a deterministic repeating week. Fixed commitments are never moved. */
export function generateSchedule(answers) {
  const errors = validateAnswers(answers);
  if (errors.length) throw new Error(errors[0].message);
  const events = [];
  const unplaced = [];
  const notes = [];
  answers.commitments.forEach((entry, index) => {
    entry.days.forEach(day => events.push({
      id: `commitment-${entry.id || index}-${day}`,
      title: entry.title.trim(), day, start: entry.start, end: entry.end,
      type: 'commitment', category: 'commitment', sourceId: entry.id || String(index), preferred: true,
    }));
  });

  answers.activities.forEach((activity, activityIndex) => {
    const dayCounts = Array(7).fill(0);
    let placed = 0;
    let outsidePreference = 0;
    for (let session = 0; session < activity.frequency; session += 1) {
      const candidates = activity.days.map(day => {
        const gaps = openGaps(answers, day, events);
        const preferredStart = firstSlot(gaps, activity.duration, PREFERENCES[activity.preference]);
        const start = preferredStart ?? firstSlot(gaps, activity.duration, PREFERENCES.any);
        const load = events.filter(event => event.day === day && event.type === 'activity')
          .reduce((sum, event) => sum + toMinutes(event.end) - toMinutes(event.start), 0);
        return { day, start, preferred: preferredStart !== null, load };
      }).filter(candidate => candidate.start !== null).sort((a, b) =>
        dayCounts[a.day] - dayCounts[b.day] || Number(b.preferred) - Number(a.preferred) || a.load - b.load || a.day - b.day);
      const selected = candidates[0];
      if (!selected) break;
      const sourceId = activity.id || String(activityIndex);
      events.push({
        id: `activity-${sourceId}-${session}`, title: activity.title.trim(), day: selected.day,
        start: clock(selected.start), end: clock(selected.start + activity.duration),
        type: 'activity', category: activity.category, sourceId, preferred: selected.preferred,
      });
      dayCounts[selected.day] += 1;
      placed += 1;
      if (!selected.preferred) outsidePreference += 1;
    }
    if (placed < activity.frequency) unplaced.push({
      activityId: activity.id || String(activityIndex), title: activity.title.trim(), requested: activity.frequency, placed,
    });
    if (outsidePreference) {
      notes.push(`${outsidePreference} ${activity.title.trim()} ${outsidePreference === 1 ? 'session was' : 'sessions were'} placed outside your preferred ${activity.preference} window to fit your available time.`);
    }
  });
  events.sort((a, b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start));
  return { events, unplaced, notes };
}

/** Check an individual edit/add. User edits may reduce default transition gaps. */
export function validateEvent(event, events, answers, { excludeId = null } = {}) {
  if (typeof event?.title !== 'string' || !event.title.trim()) return 'Give this event a name.';
  if (!Number.isInteger(event?.day) || event.day < 0 || event.day > 6) return 'Choose a day for this event.';
  const start = toMinutes(event?.start);
  const end = toMinutes(event?.end);
  const error = intervalError(start, end);
  if (error) return error;
  if (!validSleep(sleepFor(answers, event.day))) return 'Set valid wake-up and bedtimes before adding an event.';
  if (!withinAwake(start, end, answers, event.day)) return 'This event falls during your sleep time. Choose another time or update your questionnaire.';
  const conflict = (events || []).find(other => other.id !== excludeId && other.day === event.day
    && start < toMinutes(other.end) && end > toMinutes(other.start));
  if (conflict) return `This overlaps ${conflict.title}. Choose another time.`;
  return '';
}
