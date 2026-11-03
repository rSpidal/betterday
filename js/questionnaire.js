import { DAYS, validateAnswers } from './scheduler.js?v=20261103.3';
import { renderTimePicker, bindTimePickers, normalizeDraftParts } from './time-picker.js?v=20261102.2';

const STEPS = ['Your day', 'Commitments', 'Make time', 'Review'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const ACTIVITY_OPTIONS = [
  { title: 'Studying or focused work', category: 'focus', symbol: '01', description: 'Space to concentrate.' },
  { title: 'Movement or exercise', category: 'movement', symbol: '02', description: 'Time to get moving.' },
  { title: 'A hobby or personal project', category: 'hobby', symbol: '03', description: 'Something just for you.' },
  { title: 'Rest and relaxation', category: 'rest', symbol: '04', description: 'A little room to recharge.' },
];
const CHALLENGES = [
  { value: 'busy', title: 'Fitting everything in' },
  { value: 'consistent', title: 'Keeping a consistent routine' },
  { value: 'rest', title: 'Making time to recharge' },
];
const copy = value => JSON.parse(JSON.stringify(value));
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const id = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const displayTime = value => {
  if (!value) return 'Not set';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 && hour !== 24 ? 'pm' : 'am'}`;
};
const daysLabel = days => days?.length === 7 ? 'Every day' : (days || []).map(day => DAYS[day].slice(0, 3)).join(', ') || 'No days selected';

/** Mounts the four-step questionnaire. Answers belong to the caller, not this view. */
export function mountQuestionnaire(container, {
  draft,
  initialStep = 0,
  onSaveDraft = () => {},
  onComplete = () => {},
  onCancel = () => {},
  hasSchedule = false,
} = {}) {
  const supplied = copy(draft || {});
  const answers = {
    sleep: { wake: '', bed: '', overrides: {}, ...supplied.sleep },
    commitments: Array.isArray(supplied.commitments) ? supplied.commitments.map(commitment => ({ ...commitment, times: Array.isArray(commitment.times) ? commitment.times : [{ id: `time-${commitment.id}`, days: commitment.days || [], start: commitment.start || '', end: commitment.end || '', ...(commitment._plannerMasterIds ? { _plannerMasterIds: commitment._plannerMasterIds } : {}) }] })) : [],
    activities: Array.isArray(supplied.activities) ? supplied.activities : [],
    challenge: supplied.challenge || '',
    timeDrafts: Object.fromEntries(Object.entries(supplied.timeDrafts && typeof supplied.timeDrafts === 'object' && !Array.isArray(supplied.timeDrafts) ? supplied.timeDrafts : {}).map(([key, parts]) => [key, { ...normalizeDraftParts(parts), automatic: parts?.automatic === true }])),
  };
  answers.sleep.overrides ||= {};
  let step = Math.max(0, Math.min(3, Math.trunc(Number(initialStep) || 0)));
  let furthestStep = step;
  let errors = [];
  let showDayOverrides = Object.keys(answers.sleep.overrides).length > 0;
  let submitting = false;
  let saveFailed = false;
  const customDuration = new Set(answers.activities.filter(activity => ![15, 30, 45, 60].includes(Number(activity.duration))).map(activity => activity.id));
  const expandedDays = new Set(answers.activities.filter(activity => activity.days?.length !== 7).map(activity => activity.id));
  const collapsedCommitments = new Set(answers.commitments.filter(commitment => commitment.times.length > 1).map(commitment => commitment.id));
  // Restored or explicitly chosen end times belong to the user, never to the default.
  const manualEnds = new Set(answers.commitments.flatMap(commitment => commitment.times.filter(time => time.end || answers.timeDrafts[`data-bind="commitment-end" data-id="${escape(commitment.id)}" data-slot="${escape(time.id)}"`]?.automatic === false).map(time => `${commitment.id}:${time.id}`)));

  function updateSaveStatus() {
    const indicator = container.querySelector('.save-indicator');
    if (indicator) {
      indicator.textContent = saveFailed ? 'Changes are not saved' : 'Saved on this device';
      indicator.classList.toggle('save-failed', saveFailed);
    }
    const warning = container.querySelector('[data-save-warning]');
    if (warning) warning.hidden = !saveFailed;
  }
  function persist() {
    try { saveFailed = onSaveDraft(copy(answers), step) === false; }
    catch { saveFailed = true; }
    updateSaveStatus();
  }
  function focusDescriptor(element) {
    return Object.fromEntries(['focusKey', 'bind', 'action', 'kind', 'id', 'slot', 'day', 'direction', 'category'].filter(key => element.dataset[key] !== undefined).map(key => [key, element.dataset[key]]));
  }
  function restoreFocus(descriptor) {
    if (!descriptor || !Object.keys(descriptor).length) return;
    const candidates = [...container.querySelectorAll('button, input, select')];
    const target = candidates.find(element => !element.disabled && Object.entries(descriptor).every(([key, value]) => element.dataset[key] === value));
    const fallback = descriptor.id ? candidates.find(element => !element.disabled && element.dataset.id === descriptor.id) : null;
    (target || fallback)?.focus({ preventScroll: true });
  }
  function dayButtons(days, kind, itemId, slotId = '') {
    return `<div class="day-toggles" role="group" aria-label="${kind === 'commitment-slot' ? 'Days for this commitment time' : 'Available days'}">${DAYS.map((day, index) => `<button type="button" class="day-toggle ${days.includes(index) ? 'selected' : ''}" aria-pressed="${days.includes(index)}" aria-label="${day}" data-action="toggle-day" data-kind="${kind}" data-id="${escape(itemId)}" ${slotId ? `data-slot="${escape(slotId)}"` : ''} data-day="${index}" data-focus-key="${kind}-${escape(itemId)}-${escape(slotId)}-day-${index}">${day.slice(0, 3)}</button>`).join('')}</div>`;
  }
  function timeField(label, value, attributes, options = {}) {
    return renderTimePicker({ label, value, attributes: `${attributes} data-time-draft-key="${escape(attributes)}"`, draftParts: answers.timeDrafts[attributes], ...options });
  }
  function sleepStep() {
    return `<section class="question-card">
      <p class="eyebrow">01 / YOUR RHYTHM</p>
      <h2>When does your day begin?</h2>
      <p class="muted">Start with your usual wake-up time and bedtime. We'll keep this time for sleep.</p>
      <div class="form-grid">${timeField('Wake-up time', answers.sleep.wake, 'data-bind="sleep-wake"')}${timeField('Bedtime', answers.sleep.bed, 'data-bind="sleep-bed"')}</div>
      <div class="sleep-toggle"><span class="muted">${showDayOverrides ? 'Use different times on selected days.' : 'These times apply every day.'}</span><button type="button" class="text-button" data-action="toggle-overrides" aria-expanded="${showDayOverrides}" data-focus-key="overrides">${showDayOverrides ? 'Use the same times every day' : 'My times vary by day'}</button></div>
      ${showDayOverrides ? `<div class="day-overrides">${DAYS.map((day, index) => {
        const override = answers.sleep.overrides[index];
        return `<div class="day-override"><label class="checkbox-label"><input type="checkbox" data-bind="override-enabled" data-day="${index}" ${override ? 'checked' : ''}>${day}</label>${override ? `<div class="form-grid">${timeField('Wake-up', override.wake, `data-bind="override-wake" data-day="${index}"`)}${timeField('Bedtime', override.bed, `data-bind="override-bed" data-day="${index}"`)}</div>` : '<span class="muted">Uses your usual times</span>'}</div>`;
      }).join('')}</div>` : ''}
      <div class="notice">Plan around the routine that works for you. You can change these times later.</div>
    </section>`;
  }
  function commitmentTimeFields(commitment, time, timeIndex, commitmentIndex) {
    const pair = `${commitment.id}-${time.id}`;
    const startAttributes = `data-bind="commitment-start" data-id="${escape(commitment.id)}" data-slot="${escape(time.id)}"`;
    const endAttributes = `data-bind="commitment-end" data-id="${escape(commitment.id)}" data-slot="${escape(time.id)}"`;
    const removeLabel = `Remove time ${timeIndex + 1} from ${commitment.title || `commitment ${commitmentIndex + 1}`}`;
    const removeButton = commitment.times.length > 1
      ? `<button type="button" class="text-button danger-text" data-action="remove-commitment-time" data-id="${escape(commitment.id)}" data-slot="${escape(time.id)}" aria-label="${escape(removeLabel)}">Remove time</button>`
      : '';
    return `<section class="commitment-time">
      <div class="card-heading"><h4>Time ${timeIndex + 1}</h4>${removeButton}</div>
      <fieldset class="day-fieldset"><legend>Which days?</legend>${dayButtons(time.days || [], 'commitment-slot', commitment.id, time.id)}</fieldset>
      <div class="form-grid">${timeField('Starts', time.start, startAttributes, { pair, endpoint: 'start' })}${timeField('Ends', time.end, endAttributes, { pair, endpoint: 'end', endOfDay: true, automatic: !manualEnds.has(`${commitment.id}:${time.id}`) })}</div>
    </section>`;
  }
  function commitmentFields(commitment, index) {
    const collapsed = collapsedCommitments.has(commitment.id);
    const timesId = `commitment-times-${commitment.id}`;
    const summary = commitment.times.map(time => `${daysLabel(time.days)} · ${displayTime(time.start)} – ${displayTime(time.end)}`).join('  /  ');
    const timeFields = commitment.times.map((time, timeIndex) => commitmentTimeFields(commitment, time, timeIndex, index)).join('');
    return `<section class="commitment-card">
      <div class="card-heading"><h3>Commitment ${index + 1}</h3><button type="button" class="text-button danger-text" data-action="remove-commitment" data-id="${escape(commitment.id)}" aria-label="Remove commitment ${index + 1}">Remove</button></div>
      <label class="field"><span>Name</span><input type="text" value="${escape(commitment.title)}" placeholder="e.g. Biology class" maxlength="100" data-bind="commitment-title" data-id="${escape(commitment.id)}" required></label>
      <button type="button" class="commitment-times-toggle" data-action="toggle-commitment-times" data-id="${escape(commitment.id)}" aria-expanded="${!collapsed}" aria-controls="${escape(timesId)}" aria-label="${collapsed ? 'Open' : 'Close'} weekly times for ${escape(commitment.title || `commitment ${index + 1}`)}"><span class="commitment-times-toggle-label">Weekly times · ${commitment.times.length} ${commitment.times.length === 1 ? 'entry' : 'entries'}</span><span class="commitment-times-summary">${escape(summary)}</span><span class="commitment-times-toggle-icon" aria-hidden="true">⌄</span></button>
      <div class="commitment-times" id="${escape(timesId)}" ${collapsed ? 'hidden' : ''}>${timeFields}<button type="button" class="text-button add-commitment-time" data-action="add-commitment-time" data-id="${escape(commitment.id)}">+ Add another day and time</button></div>
    </section>`;
  }
  function commitmentsStep() {
    const commitmentList = answers.commitments.length
      ? `<div class="commitment-list">${answers.commitments.map(commitmentFields).join('')}</div>`
      : '<button type="button" class="empty-commitments" data-action="add-commitment" aria-labelledby="first-commitment-title" aria-describedby="first-commitment-hint"><span class="empty-symbol" aria-hidden="true">+</span><span class="empty-commitments-title" id="first-commitment-title">Add your first commitment.</span><span class="empty-commitments-hint muted" id="first-commitment-hint">Start with a class, work, an appointment, or anything with a fixed time.</span></button>';
    const commitmentHint = answers.commitments.length
      ? '<p class="field-hint">Each day and time entry repeats weekly. Midnight as an end time means the end of that day; split overnight commitments into blocks on each day.</p>'
      : '<button type="button" class="text-button skip-commitments" data-action="skip-commitments">I have no commitments yet →</button>';
    return `<section class="question-card">
      <p class="eyebrow">02 / YOUR REAL LIFE</p><h2>What's already on your calendar?</h2>
      <p class="muted">Classes, work, appointments, and anything else that has a fixed time. Add a separate day and time entry when one commitment varies across the week.</p>
      ${commitmentList}
      <button type="button" class="btn btn-secondary" data-action="add-commitment">+ Add a commitment</button>
      ${commitmentHint}
    </section>`;
  }
  function activityFields(activity, index) {
    const isCustom = activity.category === 'custom';
    const selectedDuration = customDuration.has(activity.id) ? 'other' : String(activity.duration);
    return `<section class="activity-card" data-category="${escape(activity.category)}">
      <div class="card-heading"><h3><span class="priority-number">${String(index + 1).padStart(2, '0')}</span>${isCustom ? 'Your activity' : escape(activity.title)}</h3><div class="activity-controls"><button type="button" class="text-button" data-action="move-activity" data-id="${escape(activity.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${escape(activity.title || 'activity')} up" title="Move up">↑</button><button type="button" class="text-button" data-action="move-activity" data-id="${escape(activity.id)}" data-direction="1" ${index === answers.activities.length - 1 ? 'disabled' : ''} aria-label="Move ${escape(activity.title || 'activity')} down" title="Move down">↓</button><button type="button" class="text-button danger-text" data-action="remove-activity" data-id="${escape(activity.id)}" aria-label="Remove ${escape(activity.title || 'activity')}">Remove</button></div></div>
      ${isCustom ? `<label class="field"><span>Activity name</span><input type="text" placeholder="e.g. Practice flute" value="${escape(activity.title)}" maxlength="100" data-bind="activity-title" data-id="${escape(activity.id)}" required></label>` : ''}
      <div class="form-grid form-grid-3">
        <label class="field"><span>How long each time?</span><select data-bind="activity-duration" data-id="${escape(activity.id)}">${[15, 30, 45, 60].map(duration => `<option value="${duration}" ${selectedDuration === String(duration) ? 'selected' : ''}>${duration} minutes</option>`).join('')}<option value="other" ${selectedDuration === 'other' ? 'selected' : ''}>Other duration</option></select></label>
        <label class="field"><span>Times per week</span><select data-bind="activity-frequency" data-id="${escape(activity.id)}">${[1, 2, 3, 4, 5, 6, 7].map(frequency => `<option value="${frequency}" ${Number(activity.frequency) === frequency ? 'selected' : ''}>${frequency} ${frequency === 1 ? 'time' : 'times'}</option>`).join('')}</select></label>
        <label class="field"><span>When works best?</span><select data-bind="activity-preference" data-id="${escape(activity.id)}">${[['any', 'No preference'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']].map(([value, label]) => `<option value="${value}" ${activity.preference === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div>
      ${selectedDuration === 'other' ? `<label class="field custom-duration"><span>Duration in minutes</span><input type="number" min="5" max="1440" step="1" value="${escape(activity.duration)}" data-bind="activity-custom-duration" data-id="${escape(activity.id)}" required></label>` : ''}
      <button type="button" class="text-button" data-action="expand-days" data-id="${escape(activity.id)}" aria-expanded="${expandedDays.has(activity.id)}">${expandedDays.has(activity.id) ? 'Hide available days' : 'Choose available days (optional)'}</button>
      ${expandedDays.has(activity.id) ? `<fieldset class="day-fieldset"><legend>Which days can this happen?</legend>${dayButtons(activity.days || ALL_DAYS, 'activity', activity.id)}<p class="field-hint">We'll only use these days. Your time of day is a preference.</p></fieldset>` : ''}
    </section>`;
  }
  function activitiesStep() {
    const limitReached = answers.activities.length >= 3;
    return `<section class="question-card">
      <p class="eyebrow">03 / MAKE ROOM</p><h2>What would you like more time for?</h2><p class="muted">Choose up to three activities to start. A few small intentions can make a big difference.</p>
      <div class="choice-grid">${ACTIVITY_OPTIONS.map(option => {
        const selected = answers.activities.some(activity => activity.category === option.category);
        return `<button type="button" class="choice ${selected ? 'selected' : ''}" data-action="select-activity" data-category="${option.category}" aria-pressed="${selected}" ${limitReached && !selected ? 'disabled' : ''}><span class="choice-symbol" aria-hidden="true">${option.symbol}</span><span><strong>${option.title}</strong><small>${option.description}</small></span><span class="choice-check" aria-hidden="true">${selected ? '✓' : '+'}</span></button>`;
      }).join('')}<button type="button" class="choice choice-custom" data-action="custom-activity" ${limitReached ? 'disabled' : ''}><span class="choice-symbol" aria-hidden="true">+</span><span><strong>Something else</strong><small>Make it your own.</small></span></button></div>
      ${answers.activities.length ? `<div class="activity-priority-note"><span class="eyebrow">YOUR PRIORITIES · ${answers.activities.length}/3</span><p class="muted">Most important first. We'll try to fit activities in this order.</p></div><div class="activity-list">${answers.activities.map(activityFields).join('')}</div>` : ''}
      <fieldset class="challenge-fieldset"><legend>What is your biggest scheduling challenge? <span class="optional">Optional</span></legend><p class="muted">We'll share a simple suggestion alongside your schedule.</p><div class="challenge-choices">${CHALLENGES.map(challenge => `<label class="radio-choice ${answers.challenge === challenge.value ? 'selected' : ''}"><input type="radio" name="challenge" value="${challenge.value}" data-bind="challenge" ${answers.challenge === challenge.value ? 'checked' : ''}><span>${challenge.title}</span></label>`).join('')}<label class="radio-choice ${!answers.challenge ? 'selected' : ''}"><input type="radio" name="challenge" value="" data-bind="challenge" ${!answers.challenge ? 'checked' : ''}><span>Skip for now</span></label></div></fieldset>
    </section>`;
  }
  function reviewStep() {
    const reviewHeading = (title, target) => `<div class="card-heading"><h3>${title}</h3><button type="button" class="text-button" data-action="goto" data-step="${target}" aria-label="Edit ${title.toLowerCase()}">Edit</button></div>`;
    return `<section class="question-card"><p class="eyebrow">04 / YOUR WEEK, YOUR WAY</p><h2>Does this look right?</h2><p class="muted">A little structure, with room for real life. Take a look before we put your week together.</p>
      <section class="review-section">${reviewHeading('Your daily rhythm', 0)}<div class="review-row"><span>Usual day</span><strong>${displayTime(answers.sleep.wake)} – ${displayTime(answers.sleep.bed)}</strong></div>${Object.entries(answers.sleep.overrides).map(([day, times]) => `<div class="review-row"><span>${DAYS[Number(day)]}</span><strong>${displayTime(times.wake)} – ${displayTime(times.bed)}</strong></div>`).join('')}</section>
      <section class="review-section">${reviewHeading('Fixed commitments', 1)}${answers.commitments.length ? answers.commitments.map(commitment => `<div class="review-item"><strong>${escape(commitment.title)}</strong><span class="muted">${commitment.times.map(time => `${escape(daysLabel(time.days))} · ${displayTime(time.start)} – ${displayTime(time.end)}`).join('<br>')}</span></div>`).join('') : '<p class="muted">No fixed commitments.</p>'}</section>
      <section class="review-section">${reviewHeading('Time for you', 2)}${answers.activities.map((activity, index) => `<div class="review-item"><strong>${index + 1}. ${escape(activity.title)}</strong><span class="muted">${activity.duration} min · ${activity.frequency}× per week · ${activity.preference === 'any' ? 'No time preference' : escape(activity.preference)}<br>${escape(daysLabel(activity.days))}</span></div>`).join('')}${answers.challenge ? `<div class="review-item"><strong>Your focus</strong><span class="muted">${escape(CHALLENGES.find(challenge => challenge.value === answers.challenge)?.title || '')}</span></div>` : ''}</section>
      <div class="notice">We'll keep your commitments in place and allow 10-minute transitions around suggested activities. Any time left over stays open. If something can't fit, we'll show you.</div>
      ${hasSchedule ? '<p class="field-hint">Saving updates your weekly routine from today. Separately added dated appointments, tasks, and completed history stay in your planner.</p>' : ''}
    </section>`;
  }
  function render(focus) {
    const content = [sleepStep, commitmentsStep, activitiesStep, reviewStep][step]();
    container.innerHTML = `<div class="wizard-layout"><header class="wizard-header"><div><h1>Make room for better.</h1></div><a class="text-button" href="#schedule">${hasSchedule ? 'Back to my planner' : 'Skip for now'}</a></header>
      <div class="notice" data-save-warning role="status" ${saveFailed ? '' : 'hidden'}>Your browser could not save these changes. You can keep planning in this tab, but your changes may be lost when it closes.</div>
      <ol class="stepper" aria-label="Questionnaire progress">${STEPS.map((name, index) => `<li class="stepper-item ${index === step ? 'active' : ''} ${index < step ? 'complete' : ''}"><button type="button" data-action="goto" data-step="${index}" ${index > furthestStep ? 'disabled' : ''} ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${index < step ? '✓' : index + 1}</span><span>${name}</span></button></li>`).join('')}</ol>
      <form class="questionnaire-form" novalidate>${errors.length ? `<div class="inline-error" tabindex="-1" role="alert"><strong>A quick check before we continue</strong><ul>${errors.map(error => `<li>${escape(error.message || error)}</li>`).join('')}</ul></div>` : ''}${content}
      <div class="wizard-actions"><button type="button" class="btn btn-quiet" data-action="${step ? 'back' : 'cancel'}">${step ? '← Back' : 'Back to home'}</button><span class="step-caption muted">Step ${step + 1} of 4</span><button type="submit" class="btn btn-primary" ${submitting ? 'disabled' : ''}>${submitting ? 'Creating your week…' : step === 3 ? 'Create my schedule →' : `Next: ${STEPS[step + 1]} →`}</button></div>
      <p class="wizard-footnote muted">No account needed. Your answers and schedule stay in this browser.</p></form></div>`;
    updateSaveStatus();
    if (errors.length) container.querySelector('.inline-error')?.focus();
    else restoreFocus(focus);
  }
  function goTo(target) {
    step = Math.max(0, Math.min(3, target));
    furthestStep = Math.max(furthestStep, step);
    errors = [];
    persist();
    render();
    container.querySelector('.question-card h2')?.setAttribute('tabindex', '-1');
    container.querySelector('.question-card h2')?.focus({ preventScroll: true });
    container.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function validateCurrent() {
    const form = container.querySelector('form');
    if (!form.reportValidity()) return false;
    errors = validateAnswers(answers).filter(error => error.step <= step);
    if (errors.length) { render(); return false; }
    return true;
  }
  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !container.contains(button) || button.disabled) return;
    const { action } = button.dataset;
    if (action === 'cancel') return onCancel();
    if (action === 'back') return goTo(step - 1);
    if (action === 'goto') {
      const target = Number(button.dataset.step);
      if (target > step && !validateCurrent()) return;
      return goTo(target);
    }
    if (action === 'skip-commitments') return goTo(2);
    if (action === 'toggle-overrides') {
      showDayOverrides = !showDayOverrides;
      if (!showDayOverrides) answers.sleep.overrides = {};
    } else if (action === 'add-commitment') {
      answers.commitments.push({ id: id(), title: '', times: [{ id: id(), days: [], start: '', end: '' }] });
    } else if (action === 'remove-commitment') {
      answers.commitments = answers.commitments.filter(commitment => commitment.id !== button.dataset.id);
      collapsedCommitments.delete(button.dataset.id);
    } else if (action === 'toggle-commitment-times') {
      if (collapsedCommitments.has(button.dataset.id)) collapsedCommitments.delete(button.dataset.id);
      else collapsedCommitments.add(button.dataset.id);
    } else if (action === 'add-commitment-time') {
      const commitment = answers.commitments.find(item => item.id === button.dataset.id);
      commitment.times.push({ id: id(), days: [], start: '', end: '' });
    } else if (action === 'remove-commitment-time') {
      const commitment = answers.commitments.find(item => item.id === button.dataset.id);
      if (commitment.times.length > 1) commitment.times = commitment.times.filter(time => time.id !== button.dataset.slot);
      if (commitment.times.length <= 1) collapsedCommitments.delete(button.dataset.id);
    } else if (action === 'toggle-day') {
      const day = Number(button.dataset.day);
      if (button.dataset.kind === 'commitment-slot') {
        const commitment = answers.commitments.find(candidate => candidate.id === button.dataset.id);
        const time = commitment.times.find(candidate => candidate.id === button.dataset.slot);
        time.days = time.days.includes(day) ? time.days.filter(value => value !== day) : [...time.days, day].sort((a, b) => a - b);
      } else {
        const activity = answers.activities.find(candidate => candidate.id === button.dataset.id);
        activity.days = activity.days.includes(day) ? activity.days.filter(value => value !== day) : [...activity.days, day].sort((a, b) => a - b);
      }
    } else if (action === 'select-activity') {
      const option = ACTIVITY_OPTIONS.find(candidate => candidate.category === button.dataset.category);
      const existing = answers.activities.find(activity => activity.category === option.category);
      if (existing) answers.activities = answers.activities.filter(activity => activity.id !== existing.id);
      else if (answers.activities.length < 3) answers.activities.push({ id: id(), title: option.title, category: option.category, duration: 30, frequency: 3, preference: 'any', days: [...ALL_DAYS] });
    } else if (action === 'custom-activity') {
      if (answers.activities.length < 3) answers.activities.push({ id: id(), title: '', category: 'custom', duration: 30, frequency: 3, preference: 'any', days: [...ALL_DAYS] });
    } else if (action === 'remove-activity') {
      answers.activities = answers.activities.filter(activity => activity.id !== button.dataset.id);
    } else if (action === 'move-activity') {
      const index = answers.activities.findIndex(activity => activity.id === button.dataset.id);
      const target = index + Number(button.dataset.direction);
      if (target >= 0 && target < answers.activities.length) [answers.activities[index], answers.activities[target]] = [answers.activities[target], answers.activities[index]];
    } else if (action === 'expand-days') {
      if (expandedDays.has(button.dataset.id)) expandedDays.delete(button.dataset.id);
      else expandedDays.add(button.dataset.id);
    }
    errors = [];
    persist();
    render(focusDescriptor(button));
    if (action === 'add-commitment') container.querySelector('.commitment-card:last-child input')?.focus();
    if (action === 'add-commitment-time') container.querySelector('.commitment-time:last-child .day-toggle')?.focus();
    if (action === 'remove-commitment-time') container.querySelector(`[data-action="toggle-day"][data-id="${button.dataset.id}"]`)?.focus({ preventScroll: true });
    if (action === 'custom-activity') container.querySelector('.activity-card:last-child input')?.focus();
    if (action === 'remove-commitment') container.querySelector('[data-action="add-commitment"]')?.focus({ preventScroll: true });
    if (action === 'remove-activity') container.querySelector('[data-action="custom-activity"]:not(:disabled)')?.focus({ preventScroll: true });
  }
  function handleInput(event) {
    const input = event.target;
    const bind = input.dataset.bind;
    if (!bind) return;
    if (errors.length) {
      errors = [];
      container.querySelector('.inline-error')?.remove();
    }
    const commitment = answers.commitments.find(item => item.id === input.dataset.id);
    const time = commitment?.times.find(item => item.id === input.dataset.slot);
    const activity = answers.activities.find(item => item.id === input.dataset.id);
    let redraw = false;
    if (bind === 'sleep-wake') answers.sleep.wake = input.value;
    else if (bind === 'sleep-bed') answers.sleep.bed = input.value;
    else if (bind === 'override-enabled') {
      if (input.checked) answers.sleep.overrides[input.dataset.day] = { wake: answers.sleep.wake, bed: answers.sleep.bed };
      else delete answers.sleep.overrides[input.dataset.day];
      redraw = true;
    } else if (bind === 'override-wake') answers.sleep.overrides[input.dataset.day].wake = input.value;
    else if (bind === 'override-bed') answers.sleep.overrides[input.dataset.day].bed = input.value;
    else if (bind === 'commitment-title') commitment.title = input.value;
    else if (bind === 'commitment-start') {
      time.start = input.value;
      if (time.end === '00:00' && input.value > '00:00') time.end = '24:00';
    } else if (bind === 'commitment-end') time.end = input.value === '00:00' && time.start > '00:00' ? '24:00' : input.value;
    else if (bind === 'activity-title') activity.title = input.value;
    else if (bind === 'activity-duration') {
      if (input.value === 'other') customDuration.add(activity.id);
      else { customDuration.delete(activity.id); activity.duration = Number(input.value); }
      redraw = true;
    } else if (bind === 'activity-custom-duration') activity.duration = Number(input.value);
    else if (bind === 'activity-frequency') activity.frequency = Number(input.value);
    else if (bind === 'activity-preference') activity.preference = input.value;
    else if (bind === 'challenge') {
      answers.challenge = input.value;
      container.querySelectorAll('.radio-choice').forEach(label => label.classList.toggle('selected', label.querySelector('input').checked));
    }
    persist();
    if (redraw) render(focusDescriptor(input));
  }
  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !validateCurrent()) return;
    if (step < 3) return goTo(step + 1);
    answers.commitments.forEach(commitment => { commitment.title = commitment.title.trim(); });
    answers.activities.forEach(activity => { activity.title = activity.title.trim(); });
    submitting = true;
    render();
    try { await onComplete(copy(answers)); }
    catch (error) {
      submitting = false;
      errors = [{ message: error?.message || 'We could not create your schedule. Please try again.' }];
      render();
    }
  }
  container.addEventListener('click', handleClick);
  container.addEventListener('input', handleInput);
  container.addEventListener('submit', handleSubmit);
  const cleanupTimePickers = bindTimePickers(container, { onChange: ({ input, automatic, parts, value }) => {
    if (value) delete answers.timeDrafts[input.dataset.timeDraftKey];
    else answers.timeDrafts[input.dataset.timeDraftKey] = { ...parts, automatic };
    if (input.dataset.bind === 'commitment-end' && !automatic) manualEnds.add(`${input.dataset.id}:${input.dataset.slot}`);
  } });
  render();
  return () => {
    cleanupTimePickers();
    container.removeEventListener('click', handleClick);
    container.removeEventListener('input', handleInput);
    container.removeEventListener('submit', handleSubmit);
  };
}
