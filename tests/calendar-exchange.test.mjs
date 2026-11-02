import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, exportCalendar, mergeCalendarEvents } from '../js/calendar-exchange.js';

const range = { timeZone: 'America/New_York', startDate: '2026-11-01', endDate: '2026-11-30' };
const calendar = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
const event = lines => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;

test('UTC, TZID, quoted TZID, and floating times import in the planner time zone', () => {
  const text = calendar(
    event(['UID:utc', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z', 'SUMMARY:Office hours']),
    event(['UID:london', 'DTSTART;TZID="Europe/London":20261103T150000', 'DURATION:PT45M', 'SUMMARY:Call']),
    event(['UID:floating', 'DTSTART:20261104T113000', 'DTEND:20261104T123000', 'SUMMARY:Lunch']),
  );
  const parsed = parseCalendar(text, range);
  assert.deepEqual(parsed.events.map(({ date, start, end }) => ({ date, start, end })), [
    { date: '2026-11-02', start: '10:00', end: '11:00' },
    { date: '2026-11-03', start: '10:00', end: '10:45' },
    { date: '2026-11-04', start: '11:30', end: '12:30' },
  ]);
  assert.ok(parsed.warnings.some(message => message.includes('without a time zone')));
  assert.ok(parsed.events.every(item => item.kind === 'fixed' && item.locked));
});

test('weekly recurrence retains local times through DST and excludes cancelled or moved occurrences', () => {
  const text = calendar(
    event(['UID:weekly', 'DTSTART;TZID=America/New_York:20261026T090000', 'DTEND;TZID=America/New_York:20261026T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8', 'EXDATE;TZID=America/New_York:20261104T090000', 'SUMMARY:Practice']),
    event(['UID:weekly', 'RECURRENCE-ID;TZID=America/New_York:20261109T090000', 'DTSTART;TZID=America/New_York:20261110T110000',
      'DTEND;TZID=America/New_York:20261110T120000', 'SUMMARY:Moved practice']),
    event(['UID:weekly', 'RECURRENCE-ID;TZID=America/New_York:20261111T090000', 'STATUS:CANCELLED']),
  );
  const parsed = parseCalendar(text, { ...range, startDate: '2026-10-25' });
  assert.deepEqual(parsed.events.map(e => [e.date, e.start]), [
    ['2026-10-26', '09:00'], ['2026-10-28', '09:00'], ['2026-11-02', '09:00'],
    ['2026-11-10', '11:00'], ['2026-11-16', '09:00'], ['2026-11-18', '09:00'],
  ]);
  const moved = parsed.events.find(e => e.title === 'Moved practice');
  assert.equal(moved.sourceOccurrence, `instant:${Date.parse('2026-11-09T14:00:00Z')}`);
});

test('daily count, interval, until, and weekly interval apply before exclusions and clipping', () => {
  const text = calendar(
    event(['UID:daily', 'DTSTART:20261028T140000Z', 'DURATION:PT30M', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5', 'SUMMARY:Daily']),
    event(['UID:until', 'DTSTART:20261101T180000Z', 'DURATION:PT30M', 'RRULE:FREQ=DAILY;UNTIL=20261103T180000Z', 'SUMMARY:Until']),
    event(['UID:alternate', 'DTSTART:20261030T140000Z', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=5', 'SUMMARY:Alternate']),
  );
  const parsed = parseCalendar(text, range);
  assert.deepEqual(parsed.events.filter(e => e.title === 'Daily').map(e => e.date), ['2026-11-01', '2026-11-03', '2026-11-05']);
  assert.deepEqual(parsed.events.filter(e => e.title === 'Until').map(e => e.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(parsed.events.filter(e => e.title === 'Alternate').map(e => e.date), ['2026-11-09', '2026-11-13', '2026-11-23', '2026-11-27']);
});

test('all-day exclusive ends and overnight events split into bounded daily fixed blocks', () => {
  const text = calendar(
    event(['UID:trip', 'DTSTART;VALUE=DATE:20261031', 'DTEND;VALUE=DATE:20261103', 'SUMMARY:Trip']),
    event(['UID:overnight', 'DTSTART;TZID=America/New_York:20261104T233000', 'DTEND;TZID=America/New_York:20261105T013000', 'SUMMARY:Travel']),
  );
  const parsed = parseCalendar(text, range);
  assert.deepEqual(parsed.events.map(e => [e.date, e.start, e.end, e.allDay]), [
    ['2026-11-01', '00:00', '24:00', true], ['2026-11-02', '00:00', '24:00', true],
    ['2026-11-04', '23:30', '24:00', false], ['2026-11-05', '00:00', '01:30', false],
  ]);
  assert.equal(new Set(parsed.events.map(e => e.importKey)).size, 4);
  assert.ok(parsed.warnings.some(message => message.includes('split into daily blocks')));
});

test('repeat import, downloaded BetterDay events, and imported round trips do not duplicate', () => {
  const text = calendar(event(['UID:original', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z', 'SUMMARY:Appointment']));
  const first = parseCalendar(text, range);
  const again = parseCalendar(text, { ...range, existingEvents: first.events });
  assert.equal(again.events.length, 0);
  assert.equal(again.duplicateCount, 1);
  const saved = JSON.stringify(first.events);
  const output = exportCalendar(first.events, range);
  const roundTrip = parseCalendar(output, { ...range, existingEvents: first.events });
  assert.equal(roundTrip.duplicateCount, 1);
  assert.equal(JSON.stringify(first.events), saved);
  const own = [{ id: 'task-session-1', title: 'Write', date: '2026-11-03', start: '11:52', end: '12:32', kind: 'session' }];
  assert.equal(parseCalendar(exportCalendar(own, range), { ...range, existingEvents: own }).duplicateCount, 1);
  const movedFile = text.replace('T150000Z', 'T170000Z').replace('T160000Z', 'T180000Z');
  assert.equal(parseCalendar(movedFile, { ...range, existingEvents: first.events }).duplicateCount, 1, 'a new file is not two-way sync: an existing UID is not duplicated after its time changes');
  const movedDate = text.replaceAll('20261102T', '20261202T');
  assert.equal(parseCalendar(movedDate, { ...range, startDate: '2026-12-01', endDate: '2026-12-31', existingEvents: first.events }).duplicateCount, 1, 'saved one-off identities remain recognized outside the new import date range');
});

test('export escapes text, folds UTF-8 at 75 octets, emits CRLF and valid UTC midnight', () => {
  const title = 'Practice, flute; study \\ notes\n' + '🎵'.repeat(40);
  const output = exportCalendar([{ id: 'special', title, date: '2026-11-05', start: '23:00', end: '24:00' }], { ...range, now: '2026-11-01T12:00:00Z' });
  assert.match(output, /DTSTART:20261106T040000Z\r\nDTEND:20261106T050000Z/);
  assert.match(output, /DTSTAMP:20261101T120000Z/);
  assert.ok(output.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
  assert.equal(output.replaceAll('\r\n', '').includes('\n'), false);
  const parsed = parseCalendar(output, range);
  assert.equal(parsed.events[0].title, title.slice(0, 100));
  assert.equal(parsed.events[0].end, '24:00');
});

test('unsupported recurrence, custom zones, and following-series overrides are skipped explicitly', () => {
  const text = calendar(
    event(['UID:monthly', 'DTSTART:20261102T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Monthly']),
    event(['UID:custom', 'DTSTART;TZID=Unknown/Custom:20261102T150000', 'DURATION:PT1H', 'SUMMARY:Custom zone']),
    event(['UID:future', 'DTSTART:20261102T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Original']),
    event(['UID:future', 'RECURRENCE-ID;RANGE=THISANDFUTURE:20261109T150000Z', 'DTSTART:20261109T160000Z', 'DURATION:PT1H', 'SUMMARY:Changed']),
  );
  const parsed = parseCalendar(text, range);
  assert.equal(parsed.events.length, 0);
  assert.equal(parsed.skipped, 4);
  assert.ok(parsed.warnings.some(w => w.includes('daily and weekly')));
  assert.ok(parsed.warnings.some(w => w.includes('following occurrences')));
});

test('malformed files, oversized windows, and cancellation messages fail without mutation', () => {
  assert.throws(() => parseCalendar('not a calendar', range), /calendar/i);
  assert.throws(() => parseCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR', range), /malformed/i);
  assert.throws(() => parseCalendar(calendar(), { ...range, endDate: '2028-01-01' }), /366 days/);
  assert.throws(() => parseCalendar('BEGIN:VCALENDAR\nMETHOD:CANCEL\nEND:VCALENDAR', range), /cancellation/i);
  assert.throws(() => parseCalendar('x'.repeat(5 * 1024 * 1024 + 1), range), /5 MB/);
  assert.throws(() => parseCalendar(event(['UID:outside', 'DTSTART:20261102T150000Z', 'DURATION:PT1H']) + calendar(), range), /inside VCALENDAR/);
  assert.throws(() => parseCalendar(calendar() + calendar(), range), /one complete calendar/);
});

test('missing ends and DST gaps are reported, not guessed', () => {
  const text = calendar(
    event(['UID:noend', 'DTSTART:20260308T150000Z', 'SUMMARY:No end']),
    event(['UID:gap', 'DTSTART;TZID=America/New_York:20260308T023000', 'DURATION:PT1H', 'SUMMARY:Clock gap']),
  );
  const parsed = parseCalendar(text, { ...range, startDate: '2026-03-01', endDate: '2026-03-31' });
  assert.equal(parsed.events.length, 0);
  assert.equal(parsed.skipped, 2);
  assert.ok(parsed.warnings.some(w => w.includes('does not exist')));
});

test('native recurring exports are finite snapshots and preserve excluded dates', () => {
  const events = [{ id: 'weekly', title: 'Class', date: '2026-11-02', start: '09:00', end: '10:00',
    recurrence: { frequency: 'weekly', days: [0, 2], until: '2026-11-10' }, excludedDates: ['2026-11-04'] }];
  const output = exportCalendar(events, range);
  assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal(output.includes('RRULE'), false);
  const parsed = parseCalendar(output, range);
  assert.deepEqual(parsed.events.map(e => [e.date, e.start]), [['2026-11-02', '09:00'], ['2026-11-09', '09:00']]);
  assert.equal(parseCalendar(output, { ...range, existingEvents: events }).duplicateCount, 2);
});

test('all-day exports retain DATE semantics across time zones', () => {
  const output = exportCalendar([{ id: 'holiday', title: 'Holiday', date: '2026-11-04', start: '00:00', end: '24:00', allDay: true }], range);
  assert.match(output, /DTSTART;VALUE=DATE:20261104\r\nDTEND;VALUE=DATE:20261105/);
  const parsed = parseCalendar(output, { ...range, timeZone: 'Pacific/Auckland' });
  assert.deepEqual(parsed.events.map(e => [e.date, e.start, e.end]), [['2026-11-04', '00:00', '24:00']]);
});

test('nominal day durations follow local clocks across DST', () => {
  const text = calendar(event(['UID:day-long', 'DTSTART;TZID=America/New_York:20261031T120000', 'DURATION:P1D', 'SUMMARY:Day-long shift']));
  const parsed = parseCalendar(text, { ...range, startDate: '2026-10-31' });
  assert.deepEqual(parsed.events.map(e => [e.date, e.start, e.end]), [['2026-10-31', '12:00', '24:00'], ['2026-11-01', '00:00', '12:00']]);
});

test('second-instance repeated-clock occurrences cannot silently change offset', () => {
  const text = calendar(event(['UID:second-hour', 'DTSTART:20261101T063000Z', 'DTEND:20261101T073000Z', 'SUMMARY:Late clock hour']));
  const parsed = parseCalendar(text, range);
  assert.equal(parsed.events.length, 0);
  assert.equal(parsed.skipped, 1);
  assert.ok(parsed.warnings.some(w => w.includes('cannot preserve its offset')));
});

test('approved imports batch merge without mutation, remove duplicates, and retain explicit overlaps', () => {
  const text = calendar(
    event(['UID:a', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z', 'SUMMARY:One']),
    event(['UID:b', 'DTSTART:20261102T153000Z', 'DTEND:20261102T163000Z', 'SUMMARY:Two']),
  );
  const parsed = parseCalendar(text, range);
  const existing = [parsed.events[0]];
  const before = JSON.stringify({ existing, incoming: parsed.events });
  const merged = mergeCalendarEvents(existing, parsed.events);
  assert.equal(merged.added, 1);
  assert.equal(merged.duplicateCount, 1);
  assert.equal(merged.events.length, 2);
  assert.equal(JSON.stringify({ existing, incoming: parsed.events }), before);
  merged.events[0].title = 'Changed in new snapshot';
  merged.events[1].title = 'Also changed';
  assert.equal(existing[0].title, 'One');
  assert.equal(parsed.events[1].title, 'Two');
  assert.throws(() => mergeCalendarEvents(existing, [{ ...parsed.events[1], id: existing[0].id }]), /ID conflicts/);
  assert.equal(existing.length, 1);
});

test('dense existing recurring calendars do not consume the incoming snapshot limit', () => {
  const existingEvents = Array.from({ length: 5001 }, (_, i) => ({ id: `daily-${i}`, title: 'Existing', date: '2026-01-01', start: '09:00', end: '10:00',
    recurrence: { frequency: 'daily' }, excludedDates: [] }));
  const text = calendar(event(['UID:new', 'DTSTART:20261102T150000Z', 'DURATION:PT30M', 'SUMMARY:New appointment']));
  const parsed = parseCalendar(text, { ...range, existingEvents });
  assert.equal(parsed.events.length, 1);
  const ownOccurrence = { ...existingEvents[5000], id: 'daily-5000@2026-11-02', date: '2026-11-02', recurrence: null };
  const duplicate = parseCalendar(exportCalendar([ownOccurrence], range), { ...range, existingEvents });
  assert.equal(duplicate.events.length, 0);
  assert.equal(duplicate.duplicateCount, 1);
  assert.equal(existingEvents.length, 5001);
});

test('an edited recurring occurrence retains its identity when moved across import windows', () => {
  const firstFile = calendar(
    event(['UID:series', 'DTSTART:20261102T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Class']),
    event(['UID:series', 'RECURRENCE-ID:20261109T150000Z', 'DTSTART:20261110T150000Z', 'DURATION:PT1H', 'SUMMARY:Moved class']),
  );
  const original = parseCalendar(firstFile, range);
  const changedFile = firstFile.replace('20261110T150000Z', '20261210T150000Z');
  const changed = parseCalendar(changedFile, { ...range, startDate:'2026-12-01', endDate:'2026-12-31', existingEvents:original.events });
  assert.equal(changed.events.length, 0);
  assert.equal(changed.duplicateCount, 1);
});

test('duplicate recurrence fields are reported instead of silently choosing one', () => {
  const result = parseCalendar(calendar(event(['UID:bad-rule', 'DTSTART:20261102T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=2;COUNT=3'])), range);
  assert.equal(result.events.length, 0);
  assert.equal(result.skipped, 1);
  assert.ok(result.warnings.some(message => message.includes('duplicate recurrence fields')));
});

test('transparent and malformed recurrence exceptions cannot silently create busy duplicates', () => {
  const source = event(['UID:series', 'DTSTART:20261102T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Class']);
  const free = parseCalendar(calendar(source, event(['UID:series', 'RECURRENCE-ID:20261109T150000Z', 'TRANSP:TRANSPARENT'])), range);
  assert.deepEqual(free.events.map(e => e.date), ['2026-11-02']);
  assert.ok(free.warnings.some(message => message.includes('free time')));
  const malformed = parseCalendar(calendar(source, event(['UID:series', 'RECURRENCE-ID;VALUE=DATE:20261109', 'DTSTART:20261109T180000Z', 'DURATION:PT1H'])), range);
  assert.equal(malformed.events.length, 0);
  assert.equal(malformed.skipped, 2);
  assert.ok(malformed.warnings.some(message => message.includes('different date type')));
});
