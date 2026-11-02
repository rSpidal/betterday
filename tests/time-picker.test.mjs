import test from 'node:test';
import assert from 'node:assert/strict';
import { timeParts, canonicalTime, suggestEndTime, renderTimePicker, normalizeDraftParts, bindTimePickers } from '../js/time-picker.js';

test('12-hour selection round-trips every minute without rounding', () => {
  for (let minutes = 0; minutes < 1440; minutes++) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    assert.equal(canonicalTime(timeParts(value)), value);
  }
});

test('noon and midnight have explicit, distinct canonical meanings', () => {
  assert.deepEqual(timeParts('12:00'), { hour: '12', minute: '00', period: 'PM' });
  assert.deepEqual(timeParts('00:00'), { hour: '12', minute: '00', period: 'AM' });
  assert.deepEqual(timeParts('24:00'), timeParts('00:00'));
  assert.equal(canonicalTime(timeParts('00:00'), true), '24:00');
  assert.equal(canonicalTime(timeParts('00:01'), true), '00:01');
});

test('incomplete or invalid selections remain empty instead of becoming a time', () => {
  for (const value of ['', 'invalid', '24:01', '25:00', '12:99']) assert.equal(timeParts(value).hour, '');
  for (const hour of ['', '0', '13', '1.5', '-1']) assert.equal(canonicalTime({ hour, minute: '00', period: 'AM' }), '');
  assert.equal(canonicalTime({ hour: '1', minute: '60', period: 'PM' }), '');
  assert.equal(canonicalTime({ hour: '1', minute: '00', period: '' }), '');
});

test('smart end suggestions cross noon and preserve end-of-day midnight without wrapping', () => {
  assert.equal(suggestEndTime('11:30'), '12:30');
  assert.equal(suggestEndTime('23:00'), '24:00');
  assert.equal(suggestEndTime('23:01'), '');
  assert.equal(suggestEndTime(''), '');
  assert.equal(suggestEndTime('24:00'), '');
  assert.equal(suggestEndTime('09:52'), '10:52');
});

test('rendered fields preserve existing ends and provide accessible selection controls', () => {
  const saved = renderTimePicker({ label: 'Ends', value: '24:00', name: 'end', endOfDay: true, pair: 'event', endpoint: 'end' });
  assert.match(saved, /data-time-automatic="false"/);
  assert.match(saved, /name="end" value="24:00"/);
  assert.match(saved, /aria-label="Ends hour"/);
  assert.match(saved, /aria-label="Ends minute"/);
  assert.match(saved, /aria-label="Ends AM"/);
  assert.match(saved, /aria-label="Ends PM"/);
  assert.match(saved, /Midnight · end of this day/);
  const blank = renderTimePicker({ label: 'Ends', endpoint: 'end' });
  assert.match(blank, /data-time-automatic="true"/);
  assert.match(blank, /<option value="" selected>Hour<\/option>/);
});

test('minute menus use five-minute steps and retain an existing exact minute', () => {
  const options = value => [...renderTimePicker({label:'Starts',value}).match(/<select data-time-part="minute"[^>]*>(.*?)<\/select>/s)[1].matchAll(/value="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(options('09:00'), ['00','05','10','15','20','25','30','35','40','45','50','55','exact']);
  assert.deepEqual(options('09:52'), ['00','05','10','15','20','25','30','35','40','45','50','52','55','exact']);
});

test('time labels and canonical field names are escaped', () => {
  const markup = renderTimePicker({ label: '<script>"', name: '" autofocus="true' });
  assert.ok(!markup.includes('<script>'));
  assert.match(markup, /&lt;script&gt;&quot;/);
  assert.ok(!markup.includes('name="" autofocus="true"'));
});

test('a partial minute and PM selection can be saved and rendered while the hour remains required', () => {
  const parts = JSON.parse(JSON.stringify({ hour: '', minute: '52', period: 'PM' }));
  const markup = renderTimePicker({ label: 'Bedtime', draftParts: parts });
  assert.match(markup, /<option value="" selected>Hour/);
  assert.match(markup, /<option value="52" selected>/);
  assert.match(markup, /value="PM" data-time-part="period" checked/);
  assert.match(markup, /aria-label="Bedtime hour" required/);
  assert.match(markup, /data-time-value\s+value=""/);
  const restored = renderTimePicker({ label: 'Bedtime', value: '08:12', draftParts: parts });
  assert.match(restored, /<option value="8" selected>/);
  assert.match(restored, /value="AM" data-time-part="period" checked/);
  assert.deepEqual(normalizeDraftParts({ hour: '<img>', minute: '99', period: 'invalid' }), { hour: '', minute: '00', period: 'AM' });
});

function controlsFixture(value, endpoint, automatic) {
  const parts = timeParts(value);
  const hour = { value: parts.hour }, minute = { value: parts.minute };
  const radios = ['AM', 'PM'].map(period => ({ value: period, checked: period === parts.period }));
  const input = { value, events: [], dispatchEvent(event) { this.events.push(event); } };
  const note = { hidden: true };
  const exactWrap = { hidden: true };
  const exact = { value: String(Number(parts.minute)), disabled: true, focus() {}, select() {}, setCustomValidity(message) { this.validationMessage = message; } };
  const picker = {
    dataset: { timeMinute: parts.minute, timeEndpoint: endpoint, timePair: 'test', timeAutomatic: String(automatic), timeEndOfDay: String(endpoint === 'end') },
    querySelector(selector) {
      return ({ '[data-time-value]': input, '[data-time-midnight]': note, '[data-time-part="hour"]': hour, '[data-time-part="minute"]': minute, '[data-time-part="exact"]': exact, '[data-time-exact-wrap]': exactWrap, '[data-time-part="period"]:checked': radios.find(radio => radio.checked) })[selector];
    },
    querySelectorAll: () => radios,
  };
  for (const control of [hour, minute, exact, ...radios]) {
    control.matches = selector => selector === '[data-time-part]';
    control.closest = () => picker;
  }
  return { picker, hour, minute, radios, input, note, exact, exactWrap };
}

test('exact-minute entry preserves suggestions, validates input, and protects a manual end', () => {
  const start=controlsFixture('11:00','start',false), end=controlsFixture('12:00','end',true);
  let handler;
  bindTimePickers({contains:()=>true,querySelectorAll:()=>[start.picker,end.picker],addEventListener:(name,callback)=>{handler=callback;},removeEventListener() {}});
  start.minute.value='exact';handler({target:start.minute});
  assert.equal(start.input.value,'11:00');assert.equal(start.input.events.length,0);
  assert.equal(start.exactWrap.hidden,false);assert.equal(start.exact.disabled,false);
  start.exact.value='52';handler({target:start.exact});
  assert.equal(start.input.value,'11:52');assert.equal(end.input.value,'12:52');assert.equal(end.minute.value,'52');
  assert.match(end.minute.innerHTML,/<option value="52" selected>/);
  end.minute.value='exact';handler({target:end.minute});
  assert.equal(end.picker.dataset.timeAutomatic,'true','opening exact entry does not edit the end');
  end.exact.value='57';handler({target:end.exact});
  start.minute.value='55';handler({target:start.minute});
  assert.equal(end.input.value,'12:57');assert.equal(start.exactWrap.hidden,true);assert.equal(start.exact.disabled,true);
  end.exact.value='60';handler({target:end.exact});
  assert.equal(end.input.value,'12:57');assert.ok(end.exact.validationMessage);
  end.minute.value='45';handler({target:end.minute});
  assert.equal(end.input.value,'12:45');assert.equal(end.exact.validationMessage,'');assert.equal(end.exact.disabled,true);
});

test('selection events preserve partial PM, suggest across noon, and never overwrite a manual end', () => {
  const start = controlsFixture('', 'start', false), end = controlsFixture('', 'end', true);
  let handler, removed = false;
  const changes = [];
  const root = {
    contains: () => true,
    querySelectorAll: () => [start.picker, end.picker],
    addEventListener: (name, callback) => { handler = callback; },
    removeEventListener: (name, callback) => { removed = callback === handler; },
  };
  const cleanup = bindTimePickers(root, { onChange: change => {
    changes.push({ ...change, eventCount: change.input.events.length });
  } });
  start.radios[0].checked = false;
  start.radios[1].checked = true;
  handler({ target: start.radios[1] });
  assert.equal(start.input.value, '');
  assert.equal(changes[0].parts.period, 'PM');
  assert.equal(changes[0].eventCount, 0, 'partial metadata is available before autosave event');
  start.hour.value = '1';
  handler({ target: start.hour });
  assert.equal(start.input.value, '13:00');
  assert.equal(end.input.value, '14:00');
  assert.equal(end.radios[1].checked, true);
  end.minute.value = '45';
  handler({ target: end.minute });
  assert.equal(end.input.value, '14:45');
  start.hour.value = '2';
  handler({ target: start.hour });
  assert.equal(start.input.value, '14:00');
  assert.equal(end.input.value, '14:45', 'manual end survives a start change');
  assert.equal(start.input.events[0].bubbles, true);
  cleanup();
  assert.equal(removed, true);
});
