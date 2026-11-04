/** Shared, selection-first 12-hour clock controls with canonical 24-hour values. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let nextPicker = 0;

function minuteOptions(selected) {
  const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));
  if (/^[0-5]\d$/.test(selected) && !minutes.includes(selected)) minutes.push(selected);
  return minutes.sort().map(minute => `<option value="${minute}" ${selected === minute ? 'selected' : ''}>${minute}</option>`).join('') + '<option value="exact">Exact minute…</option>';
}

export function timeParts(value = '') {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== '24:00') {
    return { hour: '', minute: '00', period: 'AM' };
  }
  const [hours, minutes] = value.split(':').map(Number);
  return { hour: String(hours % 12 || 12), minute: String(minutes).padStart(2, '0'), period: hours >= 12 && hours < 24 ? 'PM' : 'AM' };
}

export function canonicalTime({ hour, minute, period }, endOfDay = false) {
  if (!/^(?:[1-9]|1[0-2])$/.test(String(hour)) || !/^\d{2}$/.test(String(minute)) || Number(minute) > 59 || !['AM', 'PM'].includes(period)) return '';
  const hours = Number(hour) % 12 + (period === 'PM' ? 12 : 0);
  if (endOfDay && hours === 0 && Number(minute) === 0) return '24:00';
  return `${String(hours).padStart(2, '0')}:${minute}`;
}

/** Keep incomplete dropdown selections without accepting malformed draft data. */
export function normalizeDraftParts(parts) {
  return {
    hour: /^(?:[1-9]|1[0-2])$/.test(String(parts?.hour)) ? String(parts.hour) : '',
    minute: /^\d{2}$/.test(String(parts?.minute)) && Number(parts.minute) < 60 ? String(parts.minute) : '00',
    period: parts?.period === 'PM' ? 'PM' : 'AM',
  };
}

/** Return an in-day end suggestion; never silently wrap into tomorrow. */
export function suggestEndTime(start, duration = 60) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !Number.isInteger(duration) || duration <= 0) return '';
  const [hours, minutes] = start.split(':').map(Number);
  const end = hours * 60 + minutes + duration;
  return end <= 1440 ? `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` : '';
}

/**
 * attributes are trusted, application-supplied HTML attributes for the hidden input.
 * Pair controls with the same pair and endpoint=start/end for optional smart end times.
 * Set automatic=false for an existing or manually chosen end.
 */
export function renderTimePicker({ label, value = '', name = '', attributes = '', endOfDay = false, pair = '', endpoint = '', automatic = !value, required = true, draftParts = null, defaultHour = '' } = {}) {
  const parts = timeParts(value).hour ? timeParts(value) : normalizeDraftParts(draftParts);
  if (!parts.hour && defaultHour) parts.hour = String(defaultHour);
  const canonical = canonicalTime(parts, endOfDay);
  const key = `time-picker-${++nextPicker}`;
  return `<fieldset class="field time-picker" data-time-picker data-time-minute="${parts.minute}" data-time-pair="${escape(pair)}" data-time-endpoint="${escape(endpoint)}" data-time-automatic="${automatic ? 'true' : 'false'}" data-time-end-of-day="${endOfDay ? 'true' : 'false'}">
    <legend>${escape(label)}</legend>
    <div class="time-picker-controls">
      <label class="time-select"><span class="time-sr-only">${escape(label)} hour</span><select data-time-part="hour" aria-label="${escape(label)} hour" ${required ? 'required' : ''}><option value="" ${!parts.hour ? 'selected' : ''}>Hour</option>${Array.from({ length: 12 }, (_, index) => index + 1).map(hour => `<option value="${hour}" ${parts.hour === String(hour) ? 'selected' : ''}>${hour}</option>`).join('')}</select></label>
      <span class="time-colon" aria-hidden="true">:</span>
      <label class="time-select"><span class="time-sr-only">${escape(label)} minute</span><select data-time-part="minute" aria-label="${escape(label)} minute">${minuteOptions(parts.minute)}</select></label>
      <div class="time-period" role="group" aria-label="${escape(label)} AM or PM">${['AM', 'PM'].map(period => `<label><input type="radio" name="${key}-period" value="${period}" data-time-part="period" ${parts.period === period ? 'checked' : ''} aria-label="${escape(label)} ${period}"><span>${period}</span></label>`).join('')}</div>
    </div>
    <label class="time-exact" data-time-exact-wrap hidden><span>Exact minute (0–59)</span><input type="number" min="0" max="59" step="1" required disabled data-time-part="exact" aria-label="${escape(label)} exact minute" value="${Number(parts.minute)}"></label>
    <input type="hidden" data-time-value ${name ? `name="${escape(name)}"` : ''} value="${escape(canonical)}" ${attributes}>
    <small class="time-end-note" data-time-midnight ${canonical === '24:00' ? '' : 'hidden'}>Midnight · end of this day</small>
  </fieldset>`;
}

/** Bind once to a stable container. Supports newly rendered descendants. */
export function bindTimePickers(root, { onChange = () => {} } = {}) {
  function announce(picker, automatic) {
    const input = picker.querySelector('[data-time-value]');
    const note = picker.querySelector('[data-time-midnight]');
    if (note) note.hidden = input.value !== '24:00';
    const parts = {
      hour: picker.querySelector('[data-time-part="hour"]').value,
      minute: picker.querySelector('[data-time-part="minute"]').value,
      period: picker.querySelector('[data-time-part="period"]:checked')?.value || 'AM',
    };
    picker.dataset.timeMinute = parts.minute;
    // Let callers capture partial selection state before their input autosave runs.
    onChange({ input, value: input.value, automatic, picker, parts });
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setValue(picker, value) {
    const parts = timeParts(value);
    picker.querySelector('[data-time-part="hour"]').value = parts.hour;
    const minute = picker.querySelector('[data-time-part="minute"]');
    minute.innerHTML = minuteOptions(parts.minute);
    minute.value = parts.minute;
    picker.querySelector('[data-time-part="exact"]').value = String(Number(parts.minute));
    picker.querySelectorAll('[data-time-part="period"]').forEach(radio => { radio.checked = radio.value === parts.period; });
    picker.querySelector('[data-time-value]').value = value;
    announce(picker, true);
  }
  function handleInput(event) {
    const control = event.target;
    if (!control.matches?.('[data-time-part]')) return;
    const picker = control.closest('[data-time-picker]');
    if (!picker || !root.contains(picker)) return;
    const minute = picker.querySelector('[data-time-part="minute"]');
    const exact = picker.querySelector('[data-time-part="exact"]');
    const exactWrap = picker.querySelector('[data-time-exact-wrap]');
    if (control === minute && minute.value === 'exact') {
      minute.value = picker.dataset.timeMinute || '00';
      exact.value = String(Number(minute.value));
      exact.setCustomValidity('');
      exactWrap.hidden = false;
      exact.disabled = false;
      exact.focus(); exact.select();
      return;
    }
    if (control === exact) {
      picker.dataset.timeAutomatic = 'false';
      if (!/^\d{1,2}$/.test(exact.value) || Number(exact.value) > 59) {
        exact.setCustomValidity('Enter a minute from 0 to 59.');
        return;
      }
      exact.setCustomValidity('');
      const selected = String(Number(exact.value)).padStart(2, '0');
      minute.innerHTML = minuteOptions(selected);
      minute.value = selected;
    } else if (control === minute) {
      exactWrap.hidden = true;
      exact.disabled = true;
      exact.setCustomValidity('');
    }
    picker.dataset.timeAutomatic = 'false';
    const parts = {
      hour: picker.querySelector('[data-time-part="hour"]').value,
      minute: picker.querySelector('[data-time-part="minute"]').value,
      period: picker.querySelector('[data-time-part="period"]:checked')?.value,
    };
    const input = picker.querySelector('[data-time-value]');
    input.value = canonicalTime(parts, picker.dataset.timeEndOfDay === 'true');
    announce(picker, false);
    if (picker.dataset.timeEndpoint !== 'start' || !picker.dataset.timePair) return;
    const end = [...root.querySelectorAll('[data-time-picker]')].find(candidate => candidate.dataset.timePair === picker.dataset.timePair && candidate.dataset.timeEndpoint === 'end');
    if (end?.dataset.timeAutomatic === 'true') setValue(end, suggestEndTime(input.value));
  }
  root.addEventListener('input', handleInput);
  return () => root.removeEventListener('input', handleInput);
}
