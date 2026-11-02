/** Bounded, local iCalendar snapshot exchange (RFC 5545). No network requests. */
const DAY = 86400000;
const MINUTE = 60000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 5000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const formatters = new Map();
const encoder = new TextEncoder();
const dateStamp = value => value.replaceAll('-', '');
const clone = value => JSON.parse(JSON.stringify(value));

function dateEpoch(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid calendar date.');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid calendar date.');
  return value;
}
function dateAfter(date, days) { return new Date(dateEpoch(date) + days * DAY).toISOString().slice(0, 10); }
function validateRange(startDate, endDate) {
  const first = dateEpoch(startDate), last = dateEpoch(endDate);
  if (last < first || last - first > 365 * DAY) throw new Error('Choose a date range of 1 to 366 days.');
}
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
}
function localParts(epoch, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epoch)).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
function wallEpoch(date, time, timeZone, warn = () => {}) {
  formatter(timeZone);
  const normalized = time.length === 5 ? `${time}:00` : time;
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(normalized)) throw new Error('Invalid event time.');
  const naive = dateEpoch(date) + Number(normalized.slice(0, 2)) * 3600000 + Number(normalized.slice(3, 5)) * MINUTE + Number(normalized.slice(6, 8)) * 1000;
  const offsets = new Set();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = naive + delta * 3600000;
    const p = localParts(probe, timeZone);
    offsets.add(Date.parse(`${p.date}T${p.time}Z`) - probe);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(epoch => {
    const p = localParts(epoch, timeZone);
    return p.date === date && p.time === normalized;
  }).sort((a, b) => a - b);
  if (!candidates.length) throw new Error(`${date} ${time} does not exist in ${timeZone} because the clock changes.`);
  if (candidates.length > 1) warn('An ambiguous daylight-saving time uses its first occurrence. Review the affected event.');
  return candidates[0];
}
function utcStamp(epoch) { return new Date(epoch).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; }
function parseTimeProperty(property, fallbackZone, warn = () => {}) {
  if (!property) throw new Error('Missing start time.');
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(property.value);
  if (!match) throw new Error('Unsupported date/time format.');
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  dateEpoch(date);
  const allDay = !match[4];
  if (property.params.VALUE && !['DATE', 'DATE-TIME'].includes(property.params.VALUE.toUpperCase())) throw new Error('Unsupported date/time value.');
  if ((property.params.VALUE === 'DATE' && !allDay) || (property.params.VALUE === 'DATE-TIME' && allDay)) throw new Error('Date/time value does not match its declared type.');
  if (allDay) return { date, allDay: true, time: '00:00:00', zone: fallbackZone, key: `date:${date}`, epoch: null };
  const time = `${match[4]}:${match[5]}:${match[6] || '00'}`;
  const zone = match[7] ? 'UTC' : (property.params.TZID || fallbackZone);
  if (!match[7] && !property.params.TZID) warn(`Times without a time zone are interpreted in ${fallbackZone}.`);
  const epoch = wallEpoch(date, time, zone, warn);
  return { date, time, zone, allDay: false, key: `instant:${epoch}`, epoch };
}
function durationSeconds(value) {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value || '');
  if (!match || !match.slice(1).some(Boolean)) throw new Error('Unsupported event duration.');
  const seconds = Number(match[1] || 0) * 604800 + Number(match[2] || 0) * 86400 + Number(match[3] || 0) * 3600 + Number(match[4] || 0) * 60 + Number(match[5] || 0);
  if (seconds <= 0 || seconds > 366 * 86400) throw new Error('Event duration must be between one second and 366 days.');
  return seconds;
}
function durationParts(value) {
  const total = durationSeconds(value);
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  const days = Number(match[1] || 0) * 7 + Number(match[2] || 0);
  return { days, seconds: total - days * 86400 };
}
function splitUnquoted(value, delimiter) {
  const parts = [];
  let quoted = false, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '"') quoted = !quoted;
    if (value[i] === delimiter && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}
function parseProperty(line) {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 1) throw new Error('Malformed calendar property.');
  const [name, ...parameters] = splitUnquoted(line.slice(0, colon), ';');
  const params = {};
  for (const parameter of parameters) {
    const equal = parameter.indexOf('=');
    if (equal > 0) params[parameter.slice(0, equal).toUpperCase()] = parameter.slice(equal + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}
const one = (event, name) => event.properties.find(property => property.name === name);
const all = (event, name) => event.properties.filter(property => property.name === name);
const textValue = value => String(value || '').replace(/\\([nN,;\\])/g, (_, c) => /[nN]/.test(c) ? '\n' : c);
function hash(value) {
  let a = 2166136261, b = 3339675911;
  for (const char of value) { a = Math.imul(a ^ char.codePointAt(0), 16777619); b = Math.imul(b ^ char.codePointAt(0), 2246822519); }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
function parseComponents(text, warn) {
  if (typeof text !== 'string' || encoder.encode(text).length > MAX_BYTES) throw new Error('Choose an .ics file smaller than 5 MB.');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const stack = [], events = [];
  let event = null, foundCalendar = false, method = '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const property = parseProperty(line);
    if (property.name === 'BEGIN') {
      const type = property.value.toUpperCase();
      if (type === 'VCALENDAR' && (stack.length || foundCalendar)) throw new Error('Choose one complete calendar export at a time.');
      if (type !== 'VCALENDAR' && !stack.length) throw new Error('Calendar components must be inside VCALENDAR.');
      if (type === 'VEVENT' && stack.at(-1) !== 'VCALENDAR') throw new Error('Calendar events must be directly inside VCALENDAR.');
      stack.push(type);
      if (stack.length > 16) throw new Error('This calendar has invalid nested components.');
      if (type === 'VCALENDAR') foundCalendar = true;
      if (type === 'VEVENT') {
        if (event) throw new Error('Malformed nested calendar event.');
        event = { properties: [] };
      } else if (['VALARM', 'VTODO', 'VJOURNAL'].includes(type)) warn('Tasks, journal entries, and calendar alarms are not imported; this file exchange imports event times and titles.');
    } else if (property.name === 'END') {
      if (stack.pop() !== property.value.toUpperCase()) throw new Error('This calendar file is incomplete or malformed.');
      if (property.value.toUpperCase() === 'VEVENT') {
        events.push(event); event = null;
        if (events.length > MAX_EVENTS) throw new Error('This file has too many events. Export a smaller calendar or date range.');
      }
    } else if (!stack.length) throw new Error('Calendar properties must be inside VCALENDAR.');
    else if (event && stack.at(-1) === 'VEVENT') event.properties.push(property);
    else if (stack.at(-1) === 'VCALENDAR' && property.name === 'METHOD') method = property.value.toUpperCase();
  }
  if (!foundCalendar || stack.length || event) throw new Error('Choose a complete iCalendar (.ics) file.');
  if (method === 'CANCEL') throw new Error('This is a cancellation message, not a calendar export. No events were imported.');
  return events;
}
function parseRule(event, base, warn) {
  if (all(event, 'RRULE').length > 1 || one(event, 'RDATE') || one(event, 'EXRULE')) throw new Error('Multiple rules, added recurrence dates, and exclusion rules are not supported. Export individual occurrences instead.');
  const property = one(event, 'RRULE');
  if (!property) return null;
  const entries = property.value.toUpperCase().split(';').map(part => part.split('='));
  if (entries.some(entry => entry.length !== 2 || !entry[0] || !entry[1]) || new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Malformed or duplicate recurrence fields; this series was skipped.');
  const rule = Object.fromEntries(entries);
  const supported = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'];
  if (!['DAILY', 'WEEKLY'].includes(rule.FREQ) || Object.keys(rule).some(key => !supported.includes(key))) throw new Error('Only simple daily and weekly recurrence is supported. This series was skipped.');
  if (rule.COUNT && rule.UNTIL) throw new Error('A recurrence cannot have both COUNT and UNTIL.');
  const interval = Number(rule.INTERVAL || 1), count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366 || (count !== Infinity && (!Number.isInteger(count) || count < 1 || count > 1000000))) throw new Error('Invalid recurrence interval or count.');
  const weekdays = (rule.BYDAY ? rule.BYDAY.split(',') : [WEEKDAYS[new Date(dateEpoch(base.date)).getUTCDay()]]).map(day => WEEKDAYS.indexOf(day));
  if (weekdays.some(day => day < 0) || new Set(weekdays).size !== weekdays.length) throw new Error('Numbered or invalid weekday recurrence is not supported.');
  if (rule.FREQ === 'DAILY' && rule.BYDAY) throw new Error('Daily recurrence filtered by weekday is not supported; this series was skipped.');
  const wkst = WEEKDAYS.indexOf(rule.WKST || 'MO');
  if (wkst < 0) throw new Error('Invalid recurrence week start.');
  const until = rule.UNTIL ? parseTimeProperty({ value: rule.UNTIL, params: {} }, base.zone, warn) : null;
  if (until && until.allDay !== base.allDay) throw new Error('The recurrence end must use the same date type as its start.');
  return { frequency: rule.FREQ, interval, count, weekdays, wkst, until };
}
function ordinal(date, base, rule) {
  const diff = Math.round((dateEpoch(date) - dateEpoch(base.date)) / DAY);
  if (diff < 0) return 0;
  if (rule.frequency === 'DAILY') return diff % rule.interval === 0 ? diff / rule.interval + 1 : 0;
  const baseDay = new Date(dateEpoch(base.date)).getUTCDay(), day = new Date(dateEpoch(date)).getUTCDay();
  const basePosition = (baseDay - rule.wkst + 7) % 7;
  const dayPosition = (day - rule.wkst + 7) % 7;
  const week = Math.floor((diff + basePosition) / 7);
  const positions = rule.weekdays.map(d => (d - rule.wkst + 7) % 7).sort((a, b) => a - b);
  if (week % rule.interval || !positions.includes(dayPosition)) return 0;
  const firstPositions = positions.filter(p => p >= basePosition);
  if (!week) return firstPositions.indexOf(dayPosition) + 1;
  return firstPositions.length + (week / rule.interval - 1) * positions.length + positions.indexOf(dayPosition) + 1;
}
function eventDefinition(event, timeZone, warn) {
  for (const field of ['DTSTART', 'DTEND', 'DURATION', 'RECURRENCE-ID']) if (all(event, field).length > 1) throw new Error(`Repeated ${field} is not supported.`);
  const start = parseTimeProperty(one(event, 'DTSTART'), timeZone, warn);
  const endProperty = one(event, 'DTEND'), durationProperty = one(event, 'DURATION');
  if (endProperty && durationProperty) throw new Error('An event cannot have both an end and a duration.');
  let duration;
  if (endProperty) {
    const end = parseTimeProperty(endProperty, timeZone, warn);
    if (end.allDay !== start.allDay) throw new Error('Start and end use different date types.');
    duration = start.allDay ? (dateEpoch(end.date) - dateEpoch(start.date)) / 1000 : (end.epoch - start.epoch) / 1000;
  } else if (durationProperty) duration = durationSeconds(durationProperty.value);
  else if (start.allDay) duration = 86400;
  else throw new Error('An event without an end or duration was skipped.');
  if (duration <= 0 || duration > 366 * 86400 || (start.allDay && duration % 86400)) throw new Error('Event duration is invalid or exceeds 366 days.');
  const title = textValue(one(event, 'SUMMARY')?.value || 'Untitled event').trim();
  if (title.length > 100) warn('Long event titles were shortened to 100 characters.');
  return { start, duration, nominalDuration: durationProperty ? durationParts(durationProperty.value) : null,
    title: title.slice(0, 100) || 'Untitled event', rule: parseRule(event, start, warn), event };
}
function occurrenceAt(definition, date, warn) {
  const { start, duration } = definition;
  if (start.allDay) return { date, endDate: dateAfter(date, duration / 86400), allDay: true, key: `date:${date}` };
  const epoch = wallEpoch(date, start.time, start.zone, warn);
  const nominal = definition.nominalDuration;
  const endEpoch = nominal?.days ? wallEpoch(dateAfter(date, nominal.days), start.time, start.zone, warn) + nominal.seconds * 1000 : epoch + duration * 1000;
  return { epoch, endEpoch, allDay: false, key: `instant:${epoch}` };
}
function retainedKey(event) {
  const value = one(event, 'X-BETTERDAY-IMPORT-KEY')?.value;
  return value && value.length <= 4096 ? textValue(value) : null;
}

/**
 * Parse an .ics file to a reviewable, bounded snapshot. Never changes existing data.
 * startDate/endDate are inclusive. Recurrence becomes dated fixed events in this range.
 */
export function parseCalendar(text, { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, startDate, endDate, existingEvents = [] } = {}) {
  validateRange(startDate, endDate); formatter(timeZone);
  const warnings = new Set(), warn = message => warnings.add(message);
  const components = parseComponents(text, warn), events = [];
  if (!Array.isArray(existingEvents)) throw new Error('Existing calendar events must be a list.');
  // Index saved source identities across all dates, not just this import window.
  // Do not expand existing recurring calendars: a dense calendar must not consume
  // the 5,000-block allowance intended for this file's incoming rows.
  const existingById = new Map(existingEvents.map(event => [event.id, event]));
  const existingKeys = new Set(existingEvents.flatMap(event => [event.importKey, event.id ? `betterday:${event.id}` : null,
    event.sourceUid && event.sourceOccurrence ? `ics:${JSON.stringify([event.sourceUid, event.sourceOccurrence])}` : null]).filter(Boolean));
  const seen = new Set(existingKeys), groups = new Map();
  let skipped = 0, duplicateCount = 0;
  function isSavedOccurrence(id) {
    if (existingById.has(id)) return true;
    const match = /^(.*)@(\d{4}-\d{2}-\d{2})$/.exec(id || '');
    if (!match) return false;
    const master = existingById.get(match[1]), date = match[2];
    if (!master?.recurrence || date < master.date || (master.recurrence.until && date > master.recurrence.until) || master.excludedDates?.includes(date)) return false;
    if (master.recurrence.frequency === 'daily') return true;
    const day = (new Date(dateEpoch(date)).getUTCDay() + 6) % 7;
    return master.recurrence.frequency === 'weekly' && (master.recurrence.days || [(new Date(dateEpoch(master.date)).getUTCDay() + 6) % 7]).includes(day);
  }
  for (const event of components) {
    let uid = textValue(one(event, 'UID')?.value);
    if (!uid) { uid = `missing-${hash(JSON.stringify(event.properties))}`; warn('Some events had no calendar ID; repeat imports use their content to detect duplicates.'); }
    if (uid.length > 1024) { warn('An event with an unusually long calendar ID was skipped.'); skipped += 1; continue; }
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(event);
    if (event.properties.some(property => ['LOCATION', 'DESCRIPTION', 'ATTENDEE', 'ORGANIZER', 'URL', 'ATTACH'].includes(property.name))) warn('Only event titles and times are imported. Locations, notes, guests, attachments, and meeting links stay in the source calendar.');
  }

  function emit(definition, occurrence, uid, occurrenceKey = occurrence.key) {
    let first, lastExclusive;
    if (occurrence.allDay) { first = occurrence.date; lastExclusive = occurrence.endDate; }
    else {
      if (occurrence.epoch % MINUTE || occurrence.endEpoch % MINUTE) warn('Second-level times are rounded outward to whole minutes so busy time is preserved.');
      const start = Math.floor(occurrence.epoch / MINUTE) * MINUTE;
      const end = Math.ceil(occurrence.endEpoch / MINUTE) * MINUTE;
      occurrence = { ...occurrence, epoch: start, endEpoch: end };
      const startParts = localParts(start, timeZone);
      const endParts = localParts(end, timeZone);
      if (wallEpoch(startParts.date, startParts.time, timeZone, warn) !== start || wallEpoch(endParts.date, endParts.time, timeZone, warn) !== end) {
        warn(`${definition.title}: an occurrence in the second instance of a repeated clock hour was skipped because the planner cannot preserve its offset.`);
        skipped += 1;
        return;
      }
      first = startParts.date;
      lastExclusive = endParts.time === '00:00:00' ? endParts.date : dateAfter(endParts.date, 1);
    }
    const span = (dateEpoch(lastExclusive) - dateEpoch(first)) / DAY;
    if (span > 1) warn('Events spanning multiple days are split into daily blocks. Their original calendar identity is retained.');
    for (let date = first < startDate ? startDate : first; date < lastExclusive && date <= endDate; date = dateAfter(date, 1)) {
      let start = '00:00', end = '24:00';
      if (!occurrence.allDay) {
        const s = localParts(occurrence.epoch, timeZone), e = localParts(occurrence.endEpoch, timeZone);
        if (date === s.date) start = s.time.slice(0, 5);
        if (date === e.date && e.time !== '00:00:00') end = e.time.slice(0, 5);
        if (end <= start && end !== '24:00') { warn('An event across a repeated clock hour could not be represented safely and was skipped.'); skipped += 1; continue; }
      }
      const originalKey = retainedKey(definition.event);
      const betterdayId = textValue(one(definition.event, 'X-BETTERDAY-ID')?.value);
      const importKey = span === 1 && originalKey ? originalKey : span === 1 && betterdayId ? `betterday:${betterdayId}` : `ics:${JSON.stringify(span === 1 ? [uid, occurrenceKey] : [uid, occurrenceKey, date])}`;
      if (seen.has(importKey) || (span === 1 && betterdayId && isSavedOccurrence(betterdayId))) { duplicateCount += 1; continue; }
      seen.add(importKey);
      events.push({ id: `import-${hash(importKey)}`, title: definition.title, date, start, end, kind: 'fixed', locked: true, taskId: null,
        recurrence: null, excludedDates: [], sourceUid: uid, sourceOccurrence: occurrenceKey, importKey, allDay: occurrence.allDay });
      if (events.length > MAX_EVENTS) {
        const error = new Error('This date range contains more than 5,000 event blocks. Choose a shorter range.');
        error.name = 'CalendarLimitError';
        throw error;
      }
    }
  }
  for (const [uid, group] of groups) {
    const masters = group.filter(event => !one(event, 'RECURRENCE-ID'));
    const overrides = group.filter(event => one(event, 'RECURRENCE-ID'));
    const label = textValue(one(masters[0] || group[0], 'SUMMARY')?.value || 'Untitled event').slice(0, 100);
    const skip = error => { warn(`${label}: ${error.message}`); skipped += group.length; };
    const groupStart = events.length, duplicatesBefore = duplicateCount;
    try {
      if (masters.length > 1) throw new Error('Multiple versions of this event were found. Export a fresh copy; this series was skipped.');
      if (overrides.some(event => one(event, 'RECURRENCE-ID').params.RANGE)) throw new Error('Changes to this and following occurrences are not supported; this series was skipped.');
      const master = masters[0];
      if (master && one(master, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
      if (master && one(master, 'TRANSP')?.value.toUpperCase() === 'TRANSPARENT') { warn(`${label}: marked as free time in its source calendar and skipped.`); skipped += group.length; continue; }
      const definition = master ? eventDefinition(master, timeZone, warn) : null;
      const overrideMap = new Map();
      for (const event of overrides) {
        const recurrenceId = parseTimeProperty(one(event, 'RECURRENCE-ID'), definition?.start.zone || timeZone, warn);
        if (definition && recurrenceId.allDay !== definition.start.allDay) throw new Error('A changed occurrence uses a different date type from its series.');
        if (one(event, 'RRULE')) throw new Error('A changed occurrence with its own recurrence rule is not supported.');
        const key = recurrenceId.key;
        if (overrideMap.has(key)) throw new Error('Multiple changes to the same occurrence were found; this series was skipped.');
        const cancelled = one(event, 'STATUS')?.value.toUpperCase() === 'CANCELLED';
        const free = one(event, 'TRANSP')?.value.toUpperCase() === 'TRANSPARENT';
        if (free) warn(`${label}: an occurrence marked as free time was skipped.`);
        overrideMap.set(key, cancelled || free ? null : eventDefinition(event, timeZone, warn));
      }
      const excluded = new Set();
      for (const property of master ? all(master, 'EXDATE') : []) for (const value of property.value.split(',')) {
        const exclusion = parseTimeProperty({ ...property, value }, definition.start.zone, warn);
        if (exclusion.allDay !== definition.start.allDay) throw new Error('An excluded occurrence uses a different date type from its series.');
        excluded.add(exclusion.key);
      }
      // Prepare this group before adding any rows, so unsupported series cannot be partially imported.
      const occurrences = [];
      if (definition) {
        if (!definition.rule) occurrences.push(occurrenceAt(definition, definition.start.date, warn));
        else {
          warn(`Recurring events are imported as individual occurrences from ${startDate} through ${endDate}; future occurrences and later changes are not synchronized.`);
          const rule = definition.rule;
          const earliest = dateAfter(startDate, -Math.ceil(definition.duration / 86400) - 2);
          const first = definition.start.date > earliest ? definition.start.date : earliest;
          const last = dateAfter(endDate, 2);
          for (let date = first; date <= last; date = dateAfter(date, 1)) {
            const number = ordinal(date, definition.start, rule);
            if (!number || number > rule.count) continue;
            const occurrence = occurrenceAt(definition, date, warn);
            if (rule.until && (rule.until.allDay ? date > rule.until.date : occurrence.epoch > rule.until.epoch)) continue;
            occurrences.push(occurrence);
          }
        }
        for (const occurrence of occurrences) {
          if (excluded.has(occurrence.key) || overrideMap.has(occurrence.key)) continue;
          emit(definition, occurrence, uid, definition.rule ? occurrence.key : 'single');
        }
      } else if (overrides.length) warn(`${label}: the original series was not in this file; only the supplied changed occurrences are imported.`);
      for (const [key, override] of overrideMap) if (override) emit(override, occurrenceAt(override, override.start.date, warn), uid, key);
    } catch (error) {
      for (const item of events.splice(groupStart)) seen.delete(item.importKey);
      duplicateCount = duplicatesBefore;
      if (error.name === 'CalendarLimitError') throw error;
      skip(error);
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { events, warnings: [...warnings], skipped, duplicateCount, sourceEventCount: components.length };
}

function escapeText(value) { return String(value).replaceAll('\\', '\\\\').replace(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,'); }
function foldLine(line) {
  const lines = [];
  let current = '', length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) { lines.push(current); current = ' '; length = 1; }
    current += character; length += bytes;
  }
  lines.push(current);
  return lines.join('\r\n');
}
function expandedExportEvents(events, startDate, endDate) {
  const result = [];
  for (const event of events) {
    dateEpoch(event.date);
    if (!event.recurrence) {
      if (event.date >= startDate && event.date <= endDate) result.push(clone(event));
      if (result.length > MAX_EVENTS) throw new Error('Export at most 5,000 events at once. Choose a shorter range.');
      continue;
    }
    const recurrence = event.recurrence;
    if (!['daily', 'weekly'].includes(recurrence.frequency)) throw new Error('Export supports daily or weekly recurring events.');
    const days = recurrence.days || [(new Date(dateEpoch(event.date)).getUTCDay() + 6) % 7];
    if (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Invalid recurring event weekdays.');
    for (let date = event.date > startDate ? event.date : startDate; date <= endDate; date = dateAfter(date, 1)) {
      if (recurrence.until && date > recurrence.until) break;
      if (event.excludedDates?.includes(date)) continue;
      if (recurrence.frequency === 'weekly' && !days.includes((new Date(dateEpoch(date)).getUTCDay() + 6) % 7)) continue;
      result.push({ ...clone(event), id: `${event.id}@${date}`, date, recurrence: null });
      if (result.length > MAX_EVENTS) throw new Error('Export at most 5,000 events at once. Choose a shorter range.');
    }
  }
  if (result.length > MAX_EVENTS) throw new Error('Export at most 5,000 events at once. Choose a shorter range.');
  return result;
}

/** Export a bounded snapshot with stable identities and unambiguous UTC times. */
export function exportCalendar(events, { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, startDate, endDate, calendarName = 'BetterDay', now = new Date() } = {}) {
  validateRange(startDate, endDate); formatter(timeZone);
  if (!Array.isArray(events)) throw new Error('Choose events to export.');
  const snapshot = expandedExportEvents(events, startDate, endDate);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BetterDay//Day Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(calendarName)}`];
  const stamp = utcStamp(new Date(now).getTime());
  const ids = new Set();
  for (const event of snapshot) {
    if (!event.id || ids.has(event.id)) throw new Error('Every exported event needs a unique ID.');
    ids.add(event.id);
    const start = wallEpoch(event.date, event.start, timeZone);
    const end = event.end === '24:00' ? wallEpoch(dateAfter(event.date, 1), '00:00', timeZone) : wallEpoch(event.date, event.end, timeZone);
    if (end <= start) throw new Error(`${event.title || 'Event'} has an invalid time range.`);
    lines.push('BEGIN:VEVENT', `UID:${hash(event.importKey || event.id)}@betterday.local`, `DTSTAMP:${stamp}`);
    if (event.allDay) {
      if (event.start !== '00:00' || event.end !== '24:00') throw new Error('All-day blocks must span the full day.');
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.date)}`, `DTEND;VALUE=DATE:${dateStamp(dateAfter(event.date, 1))}`);
    } else lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    lines.push(`SUMMARY:${escapeText(event.title || 'Untitled event')}`, 'TRANSP:OPAQUE', `X-BETTERDAY-ID:${escapeText(event.id)}`);
    if (event.importKey) lines.push(`X-BETTERDAY-IMPORT-KEY:${escapeText(event.importKey)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Merge approved import-preview blocks in one pass. This only merges event data:
 * the caller owns planner validation, revision checks, persistence, and Undo.
 * Existing appointments and overlaps are retained; no source event is updated.
 */
export function mergeCalendarEvents(existingEvents, incomingEvents) {
  if (!Array.isArray(existingEvents) || !Array.isArray(incomingEvents)) throw new Error('Choose a valid calendar import preview.');
  if (incomingEvents.length > MAX_EVENTS) throw new Error('Import at most 5,000 event blocks at once.');
  const events = clone(existingEvents);
  const ids = new Set(events.map(event => event.id));
  if (ids.size !== events.length) throw new Error('The existing calendar has duplicate event IDs; no import was applied.');
  const keys = new Set(events.flatMap(event => [event.importKey, event.id ? `betterday:${event.id}` : null]).filter(Boolean));
  let added = 0, duplicateCount = 0;
  for (const event of incomingEvents) {
    if (!event || typeof event.id !== 'string' || !event.id || typeof event.importKey !== 'string' || !event.importKey
      || event.kind !== 'fixed' || event.taskId !== null || event.locked !== true || event.recurrence !== null) {
      throw new Error('The import preview contains an invalid calendar block; no import was applied.');
    }
    if (keys.has(event.importKey)) { duplicateCount += 1; continue; }
    if (ids.has(event.id)) throw new Error('An imported event ID conflicts with an existing event; no import was applied.');
    ids.add(event.id); keys.add(event.importKey); keys.add(`betterday:${event.id}`);
    events.push(clone(event)); added += 1;
  }
  return { events, added, duplicateCount };
}
