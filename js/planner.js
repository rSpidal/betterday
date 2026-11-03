import { toMinutes } from './scheduler.js';

export const PLANNER_VERSION = 2;
const TRANSITION = 10;
const copy = value => structuredClone(value);
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const weekday = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const validClock = (value, end = false) => typeof value === 'string' && Number.isFinite(toMinutes(value)) && toMinutes(value) >= 0 && toMinutes(value) < (end ? 1441 : 1440);
const validDays = value => Array.isArray(value) && value.length > 0 && value.every(day => integer(day, 0, 6)) && new Set(value).size === value.length;

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validTimeZone(zone) {
  try { if (typeof zone !== 'string' || !zone) return false; new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
}
export function addDays(date, count) {
  if (!isDate(date) || !Number.isInteger(count)) throw new Error('Choose a valid calendar date.');
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
export function weekStart(date) { return addDays(date, -weekday(date)); }
const transitionCache = new Map();
/** Local wall-clock intervals that cannot express one unambiguous duration on a clock-change day. */
export function clockChangeWindows(date, zone) {
  const key = `${zone}:${date}`;
  if (transitionCache.has(key)) return copy(transitionCache.get(key));
  const dayStart = Date.parse(`${date}T00:00:00Z`), minute = 60000;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const wall = instant => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type,part.value]));
    return Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
  };
  const offset = instant => wall(instant) - instant;
  const windows = [];
  let previous = dayStart - 36*60*minute, beforeOffset = offset(previous);
  for (let instant = previous + 6*60*minute; instant <= dayStart + 60*60*minute; instant += 6*60*minute) {
    const afterOffset = offset(instant);
    if (afterOffset !== beforeOffset) {
      let left = previous, right = instant;
      while (right-left > minute) { const middle = Math.floor((left+right)/2/minute)*minute; if (offset(middle) === beforeOffset) left=middle; else right=middle; }
      const oldWall = wall(right-minute)+minute, newWall = wall(right);
      const start = Math.max(0,(Math.min(oldWall,newWall)-dayStart)/minute), end = Math.min(1440,(Math.max(oldWall,newWall)-dayStart)/minute);
      if (end>start) windows.push([start,end]);
    }
    previous=instant;beforeOffset=afterOffset;
  }
  if (transitionCache.size>400) transitionCache.clear();
  transitionCache.set(key,windows);return copy(windows);
}
function zonedParts(zone, instant = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
}
export function todayInZone(zone = Intl.DateTimeFormat().resolvedOptions().timeZone, instant = new Date()) {
  const parts = zonedParts(zone, instant); return `${parts.year}-${parts.month}-${parts.day}`;
}
export function nowMinutesInZone(zone = Intl.DateTimeFormat().resolvedOptions().timeZone, instant = new Date()) {
  const parts = zonedParts(zone, instant); return Number(parts.hour) * 60 + Number(parts.minute);
}
function snapshot(state) { const value = copy(state); value.undo = null; return value; }
function fingerprint(state) { const value = { ...state }; delete value.undo; return JSON.stringify(value); }
function changed(state, next, undoState = state) { next.revision = state.revision + 1; next.undo = snapshot(undoState); assertPlanner(next); return next; }

export function emptyPlanner({ startDate, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  if (!validTimeZone(timeZone)) throw new Error('Choose a valid time zone.');
  startDate ||= weekStart(todayInZone(timeZone));
  if (!isDate(startDate)) throw new Error('Choose a valid starting date.');
  return { version: 2, revision: 0, timeZone, startDate, sleep: { wake: '07:00', bed: '23:00', wakeLatest: '07:00', bedLatest: '23:00', minSleep: 420 }, sleepOverrides: {}, tasks: [], events: [], wakeLog: {}, undo: null };
}
function recurrenceValid(value, startDate, task = false) {
  return value === null || (record(value) && ['daily', 'weekly'].includes(value.frequency)
    && (value.days === undefined || validDays(value.days))
    && (value.until === null || value.until === undefined || (isDate(value.until) && value.until >= startDate))
    && (!task || isDate(value.startDate)));
}
function sleepValid(value) {
  return record(value) && validClock(value.wake) && validClock(value.bed) && value.wake !== value.bed
    && (value.wakeLatest === undefined || (validClock(value.wakeLatest) && toMinutes(value.wakeLatest) >= toMinutes(value.wake)))
    && (value.bedLatest === undefined || (validClock(value.bedLatest) && (toMinutes(value.bedLatest) - toMinutes(value.bed) + 1440) % 1440 <= 720))
    && (value.minSleep === undefined || integer(value.minSleep, 0, 1439));
}
function validateTask(task) {
  if (!record(task) || typeof task.id !== 'string' || !task.id || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 200) return false;
  if (!integer(task.priority, 1, 100000) || !integer(task.remaining, 0, 525600) || !integer(task.duration, 1, 525600)) return false;
  if (!(task.deadline === null || isDate(task.deadline)) || !(task.deferredUntil === null || isDate(task.deferredUntil))) return false;
  if (!['active', 'completed'].includes(task.status) || typeof task.split !== 'boolean' || !integer(task.minSession, 1, 1440)) return false;
  if (!recurrenceValid(task.recurrence, task.recurrence?.startDate, true) || !Array.isArray(task.completedDates) || !task.completedDates.every(isDate) || !record(task.progressByDate)) return false;
  if (!Object.entries(task.progressByDate).every(([date, value]) => isDate(date) && integer(value, 0, 525600))) return false;
  if (task.availableFrom !== undefined && !isDate(task.availableFrom)) return false;
  if (task.history !== undefined && (!Array.isArray(task.history) || !task.history.every(item => record(item) && isDate(item.changedOn) && typeof item.title === 'string' && integer(item.remaining,0,525600) && integer(item.duration,1,525600) && ['active','completed'].includes(item.status) && recurrenceValid(item.recurrence,item.recurrence?.startDate,true) && Array.isArray(item.completedDates) && item.completedDates.every(isDate) && record(item.progressByDate) && Object.entries(item.progressByDate).every(([date,remaining])=>isDate(date)&&integer(remaining,0,525600)) && (item.completedAt === null || item.completedAt === undefined || isDate(item.completedAt))))) return false;
  if (task.completedAt !== undefined && task.completedAt !== null && !isDate(task.completedAt)) return false;
  if (task.availableDays !== undefined && !validDays(task.availableDays)) return false;
  if (task.preference !== undefined && !['any', 'morning', 'afternoon', 'evening'].includes(task.preference)) return false;
  return true;
}
function validateEvent(event) {
  return record(event) && typeof event.id === 'string' && !!event.id && typeof event.title === 'string' && !!event.title.trim() && event.title.length <= 500
    && isDate(event.date) && validClock(event.start) && validClock(event.end, true) && toMinutes(event.end) > toMinutes(event.start)
    && ['fixed', 'session'].includes(event.kind) && (event.taskId === null || typeof event.taskId === 'string') && typeof event.locked === 'boolean'
    && recurrenceValid(event.recurrence, event.date) && Array.isArray(event.excludedDates) && event.excludedDates.every(isDate)
    && (event.allDay === undefined || typeof event.allDay === 'boolean')
    && ['sourceUid','sourceOccurrence','importKey','routineMasterId','routineGroupId'].every(key => event[key] === undefined || typeof event[key] === 'string')
    && (event.routineSourceIds === undefined || (Array.isArray(event.routineSourceIds) && event.routineSourceIds.every(id => typeof id === 'string' && !!id)));
}
export function assertPlanner(state, checkUndo = true) {
  if (!record(state) || state.version !== 2 || !integer(state.revision, 0, Number.MAX_SAFE_INTEGER) || !validTimeZone(state.timeZone) || !isDate(state.startDate)
    || !sleepValid(state.sleep) || !record(state.sleepOverrides) || !Object.entries(state.sleepOverrides).every(([day, value]) => /^[0-6]$/.test(day) && sleepValid(value))
    || !Array.isArray(state.tasks) || !state.tasks.every(validateTask) || new Set(state.tasks.map(task => task.id)).size !== state.tasks.length
    || !Array.isArray(state.events) || !state.events.every(validateEvent) || new Set(state.events.map(event => event.id)).size !== state.events.length
    || !record(state.wakeLog) || !Object.entries(state.wakeLog).every(([date, value]) => isDate(date) && validClock(value))) {
    throw new Error('The saved planner has invalid data. The original saved copy has been kept.');
  }
  if (state.events.some(event => event.kind === 'session' && (!event.taskId || !state.tasks.some(task => task.id === event.taskId)))) throw new Error('A saved work session is missing its task.');
  if (checkUndo && state.undo !== null) { if (!record(state.undo) || state.undo.undo !== null) throw new Error('The saved Undo snapshot is invalid.'); assertPlanner(state.undo, false); }
  return true;
}
function occurs(recurrence, first, date) {
  if (date < first || (recurrence?.until && date > recurrence.until)) return false;
  if (!recurrence) return date === first;
  if (recurrence.frequency === 'daily') return true;
  return (recurrence.days || [weekday(first)]).includes(weekday(date));
}
export function getEventsForDate(state, date) {
  if (!isDate(date)) return [];
  return state.events.filter(event => occurs(event.recurrence, event.date, date) && !event.excludedDates.includes(date))
    .map(event => ({ ...copy(event), id: event.recurrence ? `${event.id}@${date}` : event.id, masterId: event.id, occurrenceDate: date, date }))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.id.localeCompare(b.id));
}
export function tasksForDate(state, date, { includeCompleted = false } = {}) {
  if (!isDate(date)) return [];
  const lockedTaskIds = new Set(getEventsForDate(state,date).filter(event=>event.kind==='session'&&event.locked).map(event=>event.taskId));
  const followsPattern = task => (!task.availableFrom || date>=task.availableFrom) && (!task.recurrence || occurs(task.recurrence, task.recurrence.startDate, date));
  return state.tasks.filter(task => followsPattern(task) || lockedTaskIds.has(task.id)).map(task => {
    const remaining = task.recurrence ? (task.progressByDate[date] ?? task.remaining) : task.remaining;
    const status = task.status === 'completed' || (task.recurrence && task.completedDates.includes(date)) ? 'completed' : 'active';
    let reason = '';
    if (!followsPattern(task)) reason = 'A locked work session from the previous repeat pattern stays on this date.';
    else if (task.deferredUntil && date < task.deferredUntil) reason = `Deferred until ${task.deferredUntil}.`;
    else if (task.availableDays && !task.availableDays.includes(weekday(date))) reason = 'Not available on this day.';
    return { ...copy(task), remaining, status, occurrenceDate: date, eligible: status === 'active' && remaining > 0 && !reason, reason };
  }).filter(task => includeCompleted || task.status !== 'completed').sort((a, b) => a.priority - b.priority || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.id.localeCompare(b.id));
}
export function sleepForDate(state, date) {
  const override = state.sleepOverrides[weekday(date)];
  return { ...state.sleep, ...(override || {}), ...(override ? { wakeLatest: override.wakeLatest || override.wake, bedLatest: override.bedLatest || override.bed } : {}) };
}
export function awakeWindows(state, date) {
  const sleep = sleepForDate(state, date);
  const wake = toMinutes(state.wakeLog[date] || sleep.wakeLatest || sleep.wake), bed = toMinutes(sleep.bed);
  if (state.wakeLog[date] && toMinutes(sleep.wakeLatest || sleep.wake) < bed && wake >= bed) return [];
  if (wake === bed) return [];
  return wake < bed ? [[wake, bed]] : [[0, bed], [wake, 1440]].filter(([start, end]) => end > start);
}
function removeOccurrence(next, occurrence) {
  const index = next.events.findIndex(event => event.id === (occurrence.masterId || occurrence.id));
  if (index < 0) return;
  if (next.events[index].recurrence) next.events[index].excludedDates = [...new Set([...next.events[index].excludedDates, occurrence.date])];
  else next.events.splice(index, 1);
}
function findOccurrence(state, id, date) {
  const master = state.events.find(event => event.id === id);
  date ||= id.match(/@(\d{4}-\d{2}-\d{2})$/)?.[1] || master?.date;
  return getEventsForDate(state, date).find(event => event.id === id || event.masterId === id);
}
function normalizedRecurrence(value, date, task = false) {
  if (!value || value === 'none') return null;
  const result = typeof value === 'string' ? { frequency: value } : copy(value);
  result.until ||= null;
  if (result.frequency === 'weekly') result.days ||= [weekday(date)];
  if (task) result.startDate ||= date;
  return result;
}
export function saveTask(state, values) {
  const next = copy(state), existing = next.tasks.find(task => task.id === values.id);
  const base = existing || { id: values.id || uid(), title: '', priority: Math.max(0, ...next.tasks.map(task => task.priority)) + 1, remaining: 30, duration: 30, deadline: null, deferredUntil: null, status: 'active', split: false, minSession: 15, recurrence: null, completedDates: [], progressByDate: {}, availableDays: [0,1,2,3,4,5,6], preference: 'any' };
  const value = { ...base, ...copy(values), id: values.id || base.id, title: String(values.title ?? base.title).trim() };
  value.recurrence = normalizedRecurrence(value.recurrence, values.date || state.startDate, true);
  if (!validateTask(value)) throw new Error('Check the task name, priority, duration, deadline, and recurrence.');
  if (value.remaining === 0 && value.status === 'active') throw new Error('Mark the task complete, or enter at least one minute remaining.');
  if (existing) next.tasks[next.tasks.indexOf(existing)] = value; else next.tasks.push(value);
  return changed(state, next);
}
function repeatSignature(value) {
  if (!value) return 'none';
  return JSON.stringify([value.frequency, value.frequency==='weekly' ? [...(value.days || [])].sort() : [], value.until || null]);
}
function hasFutureOccurrence(event,date,nowMinutes) {
  const first=event.date>date?event.date:date;
  if (!event.recurrence) return event.date>date || (event.date===date && toMinutes(event.start)>=nowMinutes);
  const boundaries=[first,...event.excludedDates.filter(value=>value>=first).map(value=>addDays(value,1))];
  return boundaries.some(first=>Array.from({length:8},(_,offset)=>addDays(first,offset)).some(value=>occurs(event.recurrence,event.date,value)&&!event.excludedDates.includes(value)&&(value>date||toMinutes(event.start)>=nowMinutes)));
}
function retireFlexibleSessions(next,id,date,nowMinutes) {
  for(const event of [...next.events]) {
    if(event.taskId!==id || event.kind!=='session' || event.locked) continue;
    if(!event.recurrence) {
      if(event.date>date || (event.date===date && toMinutes(event.start)>=nowMinutes)) next.events=next.events.filter(value=>value.id!==event.id);
      continue;
    }
    const keepToday=occurs(event.recurrence,event.date,date) && !event.excludedDates.includes(date) && toMinutes(event.start)<nowMinutes;
    const until=keepToday?date:addDays(date,-1);
    if(event.date>until) next.events=next.events.filter(value=>value.id!==event.id);
    else if(!event.recurrence.until || event.recurrence.until>until) event.recurrence.until=until;
  }
}
/** A form edit is one transaction. Repetition changes take effect on the chosen date. */
export function editTask(state,values,{date=todayInZone(state.timeZone),nowMinutes=nowMinutesInZone(state.timeZone)}={}) {
  if(!isDate(date)||!integer(nowMinutes,0,1440)) throw new Error('Choose a valid date and current time for this task edit.');
  const original=state.tasks.find(task=>task.id===values.id);
  if(!original) return saveTask(state,{...copy(values),date,availableFrom:date});
  const remaining=values.remaining ?? (original.recurrence ? original.progressByDate[date]??original.remaining : original.remaining);
  if(!integer(remaining,1,525600)) throw new Error('Enter at least one minute remaining, or mark the task complete.');
  const requested=Object.hasOwn(values,'recurrence')?values.recurrence:original.recurrence;
  const recurrence=normalizedRecurrence(requested,date,true);
  const patternChanged=repeatSignature(recurrence)!==repeatSignature(original.recurrence);
  if(patternChanged && state.events.some(event=>event.taskId===original.id && event.kind==='session' && event.locked && event.recurrence && hasFutureOccurrence(event,date,nowMinutes))) {
    throw new Error('This task has a locked repeating work session. Unlock it or change that session’s repeat setting before changing the task’s repeat pattern.');
  }
  const next=copy(state), task=next.tasks.find(value=>value.id===original.id);
  // Do not let a stale form overwrite saved progress/completion history.
  for(const key of ['title','priority','duration','deadline','deferredUntil','split','minSession','availableDays','preference']) if(Object.hasOwn(values,key)) task[key]=copy(values[key]);
  task.title=String(task.title).trim();
  if(patternChanged) {
    task.history=[...(original.history || []),{changedOn:date,title:original.title,remaining:original.remaining,duration:original.duration,recurrence:copy(original.recurrence),completedDates:copy(original.completedDates),progressByDate:copy(original.progressByDate),status:original.status,completedAt:original.completedAt || null}];
    retireFlexibleSessions(next,task.id,date,nowMinutes);
    task.recurrence=recurrence;
    if(task.recurrence) {
      task.recurrence.startDate=date;
      if(task.recurrence.until && task.recurrence.until<date) task.recurrence.until=null;
    }
    task.availableFrom=date;
    task.completedDates=[];task.progressByDate={};task.completedAt=null;task.status='active';
    // Changing a migrated weekday task to daily must not retain an invisible Monday-only filter.
    if(!Object.hasOwn(values,'availableDays') || values.availableDays===original.availableDays || JSON.stringify(values.availableDays)===JSON.stringify(original.availableDays)) task.availableDays=[0,1,2,3,4,5,6];
    if(task.recurrence) {task.remaining=task.duration;task.progressByDate[date]=remaining;}
    else task.remaining=remaining;
  } else if(task.recurrence) {
    task.progressByDate[date]=remaining;task.completedDates=task.completedDates.filter(value=>value!==date);task.status='active';
  } else {task.remaining=remaining;task.status='active';task.completedAt=null;}
  if(!validateTask(task)) throw new Error('Check the task name, priority, duration, deadline, and recurrence.');
  return changed(state,next);
}

/** Includes completed occurrences retained when a task's repetition pattern changes. */
export function completedTaskHistory(state) {
  const rows=new Map();
  for(const task of state.tasks) {
    for(const record of [...(task.history || []),task]) {
      const dates=[...(record.completedDates || [])];
      if(!record.recurrence && record.status==='completed' && record.completedAt) dates.push(record.completedAt);
      for(const date of dates) {
        const key=`${task.id}:${date}`;
        if(!rows.has(key)) rows.set(key,{id:task.id,title:record.title,date});
      }
    }
  }
  return [...rows.values()].sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
}
export function saveEvent(state, values, { scope = 'this', date, conflict = 'reject', nowMinutes = 0 } = {}) {
  const next = copy(state);
  const occurrence = values.id ? findOccurrence(state, values.id, date || values.occurrenceDate || values.date) : null;
  const master = occurrence ? state.events.find(event => event.id === occurrence.masterId) : state.events.find(event => event.id === values.id);
  const event = { id: values.id || uid(), title: '', date: date || values.date, start: '', end: '', kind: 'fixed', taskId: null, locked: true, recurrence: null, excludedDates: [], ...(master ? copy(master) : {}), ...copy(values) };
  event.id ||= master?.id || uid();
  event.title = String(event.title).trim();
  event.recurrence = normalizedRecurrence(event.recurrence, event.date);
  delete event.masterId; delete event.occurrenceDate;
  if (event.end === '00:00' && event.start > '00:00') event.end = '24:00';
  if (occurrence && master?.recurrence && scope === 'this') { event.id = uid(); event.recurrence = null; event.excludedDates = []; if(master.id.startsWith('legacy-') || master.routineMasterId) event.routineMasterId = master.routineMasterId || master.id; }
  else if (master) { event.id = master.id; if (scope === 'all' && master.recurrence) event.date = master.date; }
  if (!validateEvent(event)) throw new Error('Enter a name, valid date, and an end time later than the start. Split overnight events across dates.');
  if (event.kind === 'session' && !state.tasks.some(task => task.id === event.taskId)) throw new Error('Choose a task for this work session.');
  if (!event.importKey && !event.sourceUid && clockChangeWindows(event.date, state.timeZone).some(([start,end]) => toMinutes(event.start)<end && toMinutes(event.end)>start)) throw new Error('This event crosses a missing or repeated clock-change hour. Choose a time outside that hour or split the event into unambiguous blocks.');
  const planningDate = values.date || date || event.date;
  if (conflict !== 'allow') {
    const dates = new Set([event.date]);
    if (event.recurrence) {
      // Recurring series can conflict far in the future. Check each existing one-off and one full shared weekly cycle per series boundary.
      for (const other of state.events) {
        const first = other.date > event.date ? other.date : event.date;
        const boundaries = [first, ...[...event.excludedDates, ...other.excludedDates].filter(value => value >= first).map(value => addDays(value, 1))];
        for (const boundary of boundaries) for (let offset = 0; offset < 14; offset++) {
          const candidate = addDays(boundary, offset);
          if (occurs(event.recurrence, event.date, candidate)) dates.add(candidate);
        }
      }
    }
    for (const checkDate of dates) {
      if (!occurs(event.recurrence, event.date, checkDate) || event.excludedDates.includes(checkDate)) continue;
      const other = getEventsForDate(state, checkDate).find(candidate => !(scope === 'all' && candidate.masterId === master?.id) && candidate.id !== occurrence?.id
        && toMinutes(event.start) < toMinutes(candidate.end) && toMinutes(event.end) > toMinutes(candidate.start)
        && (conflict !== 'move' || candidate.kind === 'fixed' || candidate.locked || checkDate !== planningDate || toMinutes(candidate.start) < nowMinutes));
      if (other && conflict === 'move' && other.kind === 'session' && !other.locked && checkDate !== planningDate) throw new Error(`This repeating change overlaps work on ${checkDate}. Edit only this occurrence, adjust the series time, or explicitly keep the overlap.`);
      if (other) throw new Error(`This overlaps ${other.title} on ${checkDate}. Choose to move flexible work, replace an event, or keep the overlap.`);
    }
  }
  if (occurrence && master?.recurrence && scope === 'this') removeOccurrence(next, occurrence);
  else if (master) next.events = next.events.filter(item => item.id !== master.id);
  next.events.push(event);
  return changed(state, next);
}
export function deleteEvent(state, id, { scope = 'this', date } = {}) {
  const occurrence = findOccurrence(state, id, date);
  if (!occurrence) throw new Error('This event could not be found.');
  const next = copy(state);
  if (scope === 'all') next.events = next.events.filter(event => event.id !== occurrence.masterId);
  else removeOccurrence(next, occurrence);
  return changed(state, next);
}
function removeFutureSessions(next, taskId, date, nowMinutes, onlyDate = false) {
  for (const event of [...next.events]) {
    if (event.taskId !== taskId) continue;
    if (event.recurrence) {
      if (onlyDate) {
        const occurrence = getEventsForDate(next, date).find(value => value.masterId === event.id);
        if (occurrence && toMinutes(occurrence.start) >= nowMinutes) removeOccurrence(next, occurrence);
      } else {
        if (event.date > date || (event.date === date && toMinutes(event.start) >= nowMinutes)) next.events = next.events.filter(item => item.id !== event.id);
        else { event.recurrence.until = date; if (toMinutes(event.start) >= nowMinutes) event.excludedDates = [...new Set([...event.excludedDates, date])]; }
      }
    } else if ((!onlyDate && event.date > date) || (event.date === date && toMinutes(event.start) >= nowMinutes)) next.events = next.events.filter(item => item.id !== event.id);
  }
}
export function completeTask(state, id, { date = todayInZone(state.timeZone), nowMinutes = nowMinutesInZone(state.timeZone) } = {}) {
  if (!isDate(date) || !integer(nowMinutes, 0, 1440)) throw new Error('Choose a valid completion date and time.');
  const next = copy(state), task = next.tasks.find(value => value.id === id);
  if (!task) throw new Error('This task could not be found.');
  if (task.recurrence) { task.completedDates = [...new Set([...task.completedDates, date])]; task.progressByDate[date] = 0; }
  else { task.status = 'completed'; task.remaining = 0; task.completedAt = date; }
  for (const current of getEventsForDate(next, date)) {
    if (current.taskId !== id || toMinutes(current.start) >= nowMinutes || toMinutes(current.end) <= nowMinutes) continue;
    // Completion releases the unused tail while retaining the work already done.
    removeOccurrence(next, current);
    const history = { ...current, id: uid(), end: clock(nowMinutes), recurrence: null, excludedDates: [], locked: true };
    delete history.masterId; delete history.occurrenceDate;
    next.events.push(history);
  }
  removeFutureSessions(next, id, date, nowMinutes, Boolean(task.recurrence));
  return changed(state, next);
}
export function updateTaskRemaining(state, id, minutes, { date = todayInZone(state.timeZone) } = {}) {
  if (!integer(minutes, 1, 525600)) throw new Error('Enter at least one minute remaining, or mark the task complete.');
  const next = copy(state), task = next.tasks.find(value => value.id === id);
  if (!task) throw new Error('This task could not be found.');
  if (task.recurrence) { task.progressByDate[date] = minutes; task.completedDates = task.completedDates.filter(value => value !== date); }
  else { task.remaining = minutes; task.status = 'active'; task.completedAt = null; }
  return changed(state, next);
}
export function deferTask(state, id, until, { date = todayInZone(state.timeZone), nowMinutes = nowMinutesInZone(state.timeZone) } = {}) {
  if (!isDate(until) || until <= date) throw new Error('Choose a future date to defer this task.');
  if (until > addDays(date, 3660)) throw new Error('Choose a deferral date within the next ten years.');
  const next = copy(state), task = next.tasks.find(value => value.id === id);
  if (!task) throw new Error('This task could not be found.');
  task.deferredUntil = until;
  // Remove all affected occurrences before the new date, including future days.
  for (let cursor = date, count = 0; cursor < until && count < 3660; cursor = addDays(cursor, 1), count++) {
    for (const event of getEventsForDate(next, cursor)) if (event.taskId === id && (cursor > date || toMinutes(event.start) >= nowMinutes)) removeOccurrence(next, event);
  }
  return changed(state, next);
}
export function setWakeTime(state, date, time) {
  if (!isDate(date) || !validClock(time)) throw new Error('Choose a valid wake-up date and time.');
  const next = copy(state); next.wakeLog[date] = time; return changed(state, next);
}
export function updateSleep(state, settings) {
  const next = copy(state); next.sleep = { ...next.sleep, ...copy(settings) };
  if (!sleepValid(next.sleep)) throw new Error('Check your wake-up and bedtime ranges.');
  const { wake, bedLatest, bed, minSleep } = next.sleep;
  const bedtimeSpan = (toMinutes(bedLatest || bed) - toMinutes(bed) + 1440) % 1440;
  const sleepMinutes = ((toMinutes(wake) - toMinutes(bed) + 1440) % 1440) - bedtimeSpan;
  const wakeSpan = toMinutes(next.sleep.wakeLatest || wake) - toMinutes(wake);
  if (wakeSpan >= (toMinutes(bed) - toMinutes(wake) + 1440) % 1440) throw new Error('Your latest wake-up must leave awake time before bedtime.');
  if (sleepMinutes < minSleep) throw new Error('These ranges leave less than your minimum sleep. Move bedtime earlier or wake-up later.');
  return changed(state, next);
}
export function undoLastChange(state) {
  if (!state.undo) return state;
  const previous = copy(state.undo); previous.revision = state.revision + 1; previous.undo = null; assertPlanner(previous); return previous;
}
function gapsFor(windows, events, earliest) {
  const occupied = events.map(event => [Math.max(0, toMinutes(event.start) - TRANSITION), Math.min(1440, toMinutes(event.end) + TRANSITION)]).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (const [left, right] of windows) {
    let cursor = Math.max(left, earliest);
    for (const [start, end] of occupied) {
      if (end <= cursor || start >= right) continue;
      if (start > cursor) gaps.push([cursor, Math.min(start, right)]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < right) gaps.push([cursor, right]);
  }
  return gaps;
}
const preferenceWindows = { any: [0,1440], morning: [360,720], afternoon: [720,1020], evening: [1020,1440] };
function findSlot(gaps, duration, old, preference) {
  for (const previous of old) {
    const start = toMinutes(previous.start);
    if (gaps.some(([left, right]) => start >= left && start + duration <= right)) return start;
  }
  const preferred = preferenceWindows[preference] || preferenceWindows.any;
  for (const [left, right] of gaps) { const start = Math.max(left, preferred[0]); if (start + duration <= Math.min(right, preferred[1])) return start; }
  for (const [left, right] of gaps) if (left + duration <= right) return left;
  return null;
}
export function previewReplan(state, { date = todayInZone(state.timeZone), nowMinutes = 0 } = {}) {
  assertPlanner(state);
  if (!isDate(date) || !integer(nowMinutes, 0, 1440)) throw new Error('Choose a valid date and current time for replanning.');
  const existing = getEventsForDate(state, date), tasks = tasksForDate(state, date), byId = new Map(tasks.map(task => [task.id, task]));
  const movable = existing.filter(event => event.kind === 'session' && !event.locked && toMinutes(event.start) >= nowMinutes && byId.has(event.taskId));
  const preserved = existing.filter(event => !movable.includes(event));
  const events = [], unplaced = [], changes = [], notes = [], extraRemovals = [];
  let windows = awakeWindows(state, date);
  const clockChanges = clockChangeWindows(date,state.timeZone);
  for (const [blockedStart,blockedEnd] of clockChanges) windows = windows.flatMap(([start,end]) => {
    if (end<=blockedStart || start>=blockedEnd) return [[start,end]];
    return [[start,Math.min(end,blockedStart)],[Math.max(start,blockedEnd),end]].filter(([left,right])=>right>left);
  });
  if(clockChanges.length) notes.push('The clock changes on this date. Missing or repeated clock-change hours are left free so work-session lengths stay unambiguous.');
  for (const task of tasks) {
    const before = movable.filter(event => event.taskId === task.id);
    if (!task.eligible) {
      if (before.length) changes.push({ taskId: task.id, title: task.title, before, after: [], reason: task.reason || 'This task is complete.' });
      continue;
    }
    let reserved = preserved.filter(event => event.taskId === task.id).reduce((sum, event) => sum + Math.max(0, toMinutes(event.end) - Math.max(nowMinutes, toMinutes(event.start))), 0);
    if (!task.recurrence) {
      const future = state.events.filter(event => event.taskId === task.id && event.date > date).sort((a,b) => Number(b.locked) - Number(a.locked) || a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
      for (const event of future) {
        const duration = toMinutes(event.end) - toMinutes(event.start);
        if (event.locked || reserved + duration <= task.remaining) reserved += duration;
        else {
          extraRemovals.push({ ...copy(event), masterId: event.id, id: event.recurrence ? `${event.id}@${event.date}` : event.id });
          changes.push({ taskId: task.id, title: task.title, before: [copy(event)], after: [], reason: `Remove excess flexible work on ${event.date} after the remaining estimate changed. Any still-needed time is considered for today.` });
        }
      }
    }
    if (reserved > task.remaining) notes.push(`${task.title} has more protected session time than its remaining estimate. Edit those locked sessions if you want to release that time.`);
    let remaining = Math.max(0, task.remaining - reserved), placed = [];
    while (remaining > 0) {
      const gaps = gapsFor(windows, [...preserved, ...events], nowMinutes);
      let duration = remaining;
      let start = findSlot(gaps, duration, before, task.preference);
      if (start === null && task.split) {
        const minimum = Math.min(task.minSession, remaining);
        const candidate = gaps.find(([left, right]) => right - left >= minimum);
        if (candidate) { start = candidate[0]; duration = Math.min(remaining, candidate[1] - candidate[0]); }
      }
      if (start === null) break;
      let serial = placed.length;
      const usedIds = new Set([...preserved.map(event => event.masterId || event.id), ...events.map(event => event.id)]);
      while (usedIds.has(`plan-${date}-${task.id}-${serial}`)) serial++;
      const event = { id: `plan-${date}-${task.id}-${serial}`, title: task.title, date, start: clock(start), end: clock(start + duration), kind: 'session', taskId: task.id, locked: false, recurrence: null, excludedDates: [] };
      events.push(event); placed.push(event); remaining -= duration;
      if (!task.split) break;
    }
    if (remaining) unplaced.push({ taskId: task.id, title: task.title, minutes: remaining, reason: task.split ? 'Not enough suitable time remains around protected events and sleep.' : `No uninterrupted ${remaining}-minute block is available. Try splitting the task or another day.` });
    if (task.deadline && task.deadline < date) notes.push(`${task.title} is overdue (due ${task.deadline}).`);
    const equivalent = before.length === placed.length && before.every((event, index) => event.start === placed[index].start && event.end === placed[index].end);
    if (!equivalent) changes.push({ taskId: task.id, title: task.title, before, after: placed, reason: placed.length ? before.length ? 'Adjusted around protected commitments, available time, and priority.' : 'Scheduled using your priority and remaining effort.' : 'No suitable time remains today.' });
  }
  const conflicts = [];
  for (let i = 0; i < preserved.length; i++) for (let j = i + 1; j < preserved.length; j++) {
    if (toMinutes(preserved[i].start) < toMinutes(preserved[j].end) && toMinutes(preserved[i].end) > toMinutes(preserved[j].start)) conflicts.push(`${preserved[i].title} overlaps ${preserved[j].title}.`);
  }
  notes.push(...conflicts.map(message => `Protected events were kept: ${message}`));
  const sleep = sleepForDate(state, date), actualWake = state.wakeLog[date];
  if (actualWake && ((toMinutes(actualWake) - toMinutes(sleep.bedLatest || sleep.bed) + 1440) % 1440) < sleep.minSleep) notes.push('Your recorded wake-up leaves less than your minimum sleep based on your usual bedtime. Your bedtime has not been pushed later.');
  const removals = [...movable, ...extraRemovals].map(event => ({ id: event.id, date: event.date }));
  return { date, nowMinutes, baseRevision: state.revision, baseFingerprint: fingerprint(state), events, removeIds: removals.map(event => event.id), removals, changes, unplaced, notes, preserved };
}
export function applyReplan(state, preview, { undoState = state } = {}) {
  if (!preview || preview.baseRevision !== state.revision || preview.baseFingerprint !== fingerprint(state)) throw new Error('Your plan changed since this preview. Preview it again before applying.');
  const next = copy(state);
  for (const item of preview.removals || preview.removeIds.map(id => ({ id, date: preview.date }))) { const event = findOccurrence(next, item.id, item.date); if (event) removeOccurrence(next, event); }
  for (const event of preview.events) {
    const clash = next.events.find(item => item.id === event.id);
    if (clash) throw new Error('A proposed session conflicts with an existing session identifier. Preview again.');
    next.events.push(copy(event));
  }
  return changed(state, next, undoState);
}
export function migrateLegacy(legacy, { startDate, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const next = emptyPlanner({ startDate, timeZone });
  if (!legacy?.schedule || !legacy?.answers) return next;
  const originalSleep = legacy.answers.sleep;
  if (originalSleep) {
    const minutes = (toMinutes(originalSleep.wake) - toMinutes(originalSleep.bed) + 1440) % 1440;
    next.sleep = { wake: originalSleep.wake, bed: originalSleep.bed, wakeLatest: originalSleep.wake, bedLatest: originalSleep.bed, minSleep: Math.min(420, minutes) };
    next.sleepOverrides = copy(originalSleep.overrides || {});
  }
  const monday = weekStart(next.startDate), tasksBySource = new Map();
  for (const old of legacy.schedule.events) {
    let date = addDays(monday, old.day); if (date < next.startDate) date = addDays(date, 7);
    const recurrence = { frequency: 'weekly', days: [old.day], until: null };
    const event = { id: `legacy-${old.id}`, title: old.title, date, start: old.start, end: old.end, kind: old.type === 'commitment' ? 'fixed' : 'session', taskId: null, locked: old.type === 'commitment', recurrence, excludedDates: [] };
    if (old.type === 'commitment') {
      const commitment = legacy.answers.commitments.find(item => item.id === old.sourceId);
      const time = (Array.isArray(commitment?.times) ? commitment.times : [commitment]).find(item => item && item.start === old.start && item.end === old.end && item.days?.includes(old.day));
      event.routineGroupId = old.sourceId || old.id;
      const masterIds = time?._plannerMasterIds || commitment?._plannerMasterIds;
      if (Array.isArray(masterIds)) event.routineSourceIds = copy(masterIds);
    }
    if (old.type !== 'commitment') {
      const activity = legacy.answers.activities.find(item => item.id === old.sourceId);
      const duration = toMinutes(old.end) - toMinutes(old.start), id = `task-${old.id}`;
      const task = { id, title: old.title, priority: activity ? legacy.answers.activities.indexOf(activity) + 1 : legacy.answers.activities.length + 1, remaining: duration, duration, deadline: null, deferredUntil: null, status: 'active', split: false, minSession: Math.min(15, duration), recurrence: { ...recurrence, startDate: date }, completedDates: [], progressByDate: {}, availableDays: [old.day], preference: activity?.preference || 'any', legacySourceId: old.sourceId };
      next.tasks.push(task); event.taskId = id;
      if (old.sourceId) tasksBySource.set(old.sourceId, (tasksBySource.get(old.sourceId) || 0) + 1);
    }
    next.events.push(event);
  }
  // Unplaced intentions remain visible as tasks instead of disappearing during migration.
  for (const activity of legacy.answers.activities) {
    const missing = Math.max(0, activity.frequency - (tasksBySource.get(activity.id) || 0));
    for (let index = 0; index < missing; index++) {
      const day = activity.days[index % activity.days.length];
      let date = addDays(monday, day); if (date < next.startDate) date = addDays(date, 7);
      next.tasks.push({ id: `task-unplaced-${activity.id}-${index}`, title: activity.title, priority: legacy.answers.activities.indexOf(activity) + 1, remaining: activity.duration, duration: activity.duration, deadline: null, deferredUntil: null, status: 'active', split: false, minSession: Math.min(15, activity.duration), recurrence: { frequency: 'weekly', days: [day], startDate: date, until: null }, completedDates: [], progressByDate: {}, availableDays: copy(activity.days), preference: activity.preference, legacySourceId: activity.id });
    }
  }
  next.migratedFrom = { version: 1, startDate: next.startDate };
  assertPlanner(next); return next;
}

/** Replace only the migrated weekly routine, keeping user-added tasks/events and historical work. */
export function replaceRoutine(state, legacy, { startDate = todayInZone(state.timeZone) } = {}) {
  if (!isDate(startDate)) throw new Error('Choose a valid date for the new routine.');
  const generated = migrateLegacy(legacy, { startDate, timeZone: state.timeZone });
  const next = copy(state);
  const legacyTasks = new Set(next.tasks.filter(task => Object.hasOwn(task, 'legacySourceId')).map(task => task.id));
  for (const event of [...next.events]) {
    if (!event.id.startsWith('legacy-') && !legacyTasks.has(event.taskId)) continue;
    if (event.date >= startDate) next.events = next.events.filter(item => item.id !== event.id);
    else if (event.recurrence && (!event.recurrence.until || event.recurrence.until >= startDate)) event.recurrence.until = addDays(startDate, -1);
  }
  next.tasks = next.tasks.filter(task => !legacyTasks.has(task.id) || !task.recurrence || task.recurrence.startDate < startDate || next.events.some(event => event.taskId === task.id));
  for (const task of next.tasks) {
    if (!legacyTasks.has(task.id) || !task.recurrence) continue;
    if (task.recurrence.startDate < startDate) task.recurrence.until = addDays(startDate, -1);
    // Retiring a routine does not claim unfinished intentions were completed.
  }
  // Keep old identities for history and create separate identities for the replacement series.
  const suffix = `-routine-${state.revision + 1}`;
  for (const task of generated.tasks) { task.id += suffix; next.tasks.push(task); }
  for (const event of generated.events) {
    if(event.kind === 'fixed' && event.routineSourceIds) event.excludedDates = [...new Set(event.routineSourceIds.flatMap(id => state.events.find(item => item.id === id)?.excludedDates || []))];
    event.id += suffix; if (event.taskId) event.taskId += suffix; next.events.push(event);
  }
  next.sleep = generated.sleep; next.sleepOverrides = generated.sleepOverrides;
  return changed(state, next);
}

/** Current migrated fixed series, suitable for the questionnaire's keep-commitments option. */
export function routineCommitments(state, { date = todayInZone(state.timeZone) } = {}) {
  const groups = new Map();
  for (const event of state.events) {
    if (event.kind !== 'fixed' || !event.id.startsWith('legacy-') || !event.recurrence || (event.recurrence.until && event.recurrence.until < date)) continue;
    const legacyId = event.id.match(/^legacy-commitment-(.+)-[0-6]$/)?.[1];
    const groupId = event.routineGroupId || legacyId || event.title;
    const key = JSON.stringify([groupId, event.title]);
    if (!groups.has(key)) groups.set(key, { id: `routine-${groupId}`, title: event.title, times: [] });
    const group = groups.get(key);
    let time = group.times.find(item => item.start === event.start && item.end === event.end);
    if (!time) {
      time = { id: `routine-time-${event.start.replace(':', '')}-${event.end.replace(':', '')}`, start: event.start, end: event.end, days: [], _plannerMasterIds: [] };
      group.times.push(time);
    }
    const days = event.recurrence.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : event.recurrence.days || [weekday(event.date)];
    time.days = [...new Set([...time.days, ...days])].sort((a, b) => a - b);
    time._plannerMasterIds.push(event.id);
  }
  return [...groups.values()];
}
