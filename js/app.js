import { DAYS, toMinutes, formatTime, generateSchedule, validateEvent } from './scheduler.js';
import { mountQuestionnaire } from './questionnaire.js';
import { blankAnswers, loadState, saveState } from './storage.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const icon = (name, size = 18) => {
  const paths = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    leaf: '<path d="M19 4C7 3 3 8 5 15c7 4 15 0 14-11Z"/><path d="m4 21 11-12"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="m16 4 4 4L9 19l-5 1 1-5L16 4Z"/><path d="m13 7 4 4"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
};
const loaded = loadState();
let state = loaded.state;
// An untouched empty form does not need a resume prompt on the home page.
if (state.draft && !state.draft.sleep.wake && !state.draft.sleep.bed &&
    !Object.keys(state.draft.sleep.overrides).length && !state.draft.commitments.length &&
    !state.draft.activities.length && !state.draft.challenge) {
  state.draft = null;
  state.draftStep = 0;
}
let cleanupQuestionnaire;
let view = window.innerWidth <= 760 ? 'day' : 'week';
let selectedDay = (new Date().getDay() + 6) % 7;
let toastTimer;
let dialogFocus;
const main = $('#main-content');
const dialog = $('#app-dialog');

function storageNotice(message) {
  const notice = $('#storage-notice');
  notice.textContent = message;
  notice.hidden = !message;
}
if (loaded.error) storageNotice(loaded.error);
function persist() {
  const saved = saveState(state);
  if (!saved) storageNotice('Your changes work for this visit, but this browser couldn’t save them. They may be lost when you close or refresh the page.');
  return saved;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function routeName() {
  const hash = location.hash.slice(1);
  return ['home', 'questionnaire', 'schedule'].includes(hash) ? hash : 'home';
}
function navigate(route) {
  if (location.hash === `#${route}`) render();
  else location.hash = route;
}
function header(route) {
  $('#main-nav').innerHTML = `<a href="#home" ${route === 'home' ? 'aria-current="page"' : ''}>Home</a><a class="nav-questionnaire" href="#questionnaire" data-action="app-questionnaire" ${route === 'questionnaire' ? 'aria-current="page"' : ''}>${state.draft ? 'Continue setup' : 'Questionnaire'}</a><a class="nav-cta" href="${state.schedule ? '#schedule' : '#questionnaire'}" ${!state.schedule ? 'data-action="app-questionnaire"' : ''} ${route === 'schedule' ? 'aria-current="page"' : ''}>${state.schedule ? 'My schedule' : 'Get started'}</a>`;
}
function primaryCTA(extra = '') {
  return `<a class="btn btn-primary ${extra}" href="${state.schedule ? '#schedule' : '#questionnaire'}" ${state.schedule ? '' : 'data-action="app-questionnaire"'}>${state.schedule ? 'View my schedule' : state.draft ? 'Continue my questionnaire' : 'Create my schedule'}${icon('arrow')}</a>`;
}
function homePreview() {
  const sample = [
    { start: '09:00', end: '11:00', title: 'Classes & commitments', type: 'commitment' },
    { start: '12:30', end: '13:00', title: 'A little time outside', type: 'activity' },
    { start: '15:00', end: '16:00', title: 'Space for your goals', type: 'activity' },
  ];
  let previewDay = selectedDay;
  if (state.schedule && !state.schedule.events.some(event => event.day === previewDay)) previewDay = state.schedule.events[0]?.day ?? selectedDay;
  const events = state.schedule ? state.schedule.events.filter(event => event.day === previewDay).slice(0, 3) : sample;
  return `<div class="hero-art"><div class="preview-card"><div class="preview-top"><div><small>${state.schedule ? 'YOUR WEEK, YOUR WAY' : 'AN EXAMPLE DAY'}</small><strong>${DAYS[state.schedule ? previewDay : 0]}, with room to breathe.</strong></div>${icon('leaf', 24)}</div><div class="preview-days" aria-hidden="true">${DAYS.map((day, index) => `<span class="${index === (state.schedule ? previewDay : 0) ? 'selected' : ''}">${day.charAt(0)}</span>`).join('')}</div>${events.length ? events.map(event => `<div class="preview-event"><span>${escape(formatTime(event.start))}</span><div><strong>${escape(event.title)}</strong><small>${escape(formatTime(event.start))} – ${escape(formatTime(event.end))}</small></div></div>`).join('') : '<div class="preview-event"><div><strong>A little open space.</strong><small>Your time is yours to shape.</small></div></div>'}</div><svg class="leaf-decoration" viewBox="0 0 130 160" fill="none" aria-hidden="true"><path d="M103 157C79 122 83 72 52 24" stroke="#567653" stroke-width="2"/><path d="M82 107C37 112 33 87 34 75c30-1 44 11 48 32Z" fill="#9fba92"/><path d="M77 82c32 0 43-24 36-44-31 6-39 23-36 44Z" fill="#7d9d70"/><path d="M63 52C34 52 24 31 28 12c24 4 38 20 35 40Z" fill="#b4c9a6"/><path d="M91 133c33-4 37-20 34-35-24 4-34 15-34 35Z" fill="#b0c6a1"/></svg></div>`;
}
function renderHome() {
  main.innerHTML = `<div class="home"><section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-dot"></span>YOUR BETTER DAY STARTS NOW</p><h1>A little structure.<br>More room<br><em>for you.</em></h1><p class="hero-description">Life feels better with a little balance. Build a routine around your commitments, your goals, and the things that make you, you.</p><div class="hero-actions">${primaryCTA()}<a class="btn btn-quiet" href="#how-it-works" data-action="app-how">How it works ${icon('arrow', 15)}</a></div></div>${homePreview()}</section><section id="how-it-works" aria-labelledby="how-heading"><div class="intro-strip"><h2 id="how-heading">Better days, by design.</h2><span class="rule"></span></div><div class="how-grid"><article class="how-item"><span class="how-number">01</span><h3>Start with your real life.</h3><p>Tell us about your usual day and the commitments already on your calendar.</p></article><article class="how-item"><span class="how-number">02</span><h3>Make time for what matters.</h3><p>Choose a few things you’d like more room for. We’ll find space around your schedule.</p></article><article class="how-item"><span class="how-number">03</span><h3>Find your own rhythm.</h3><p>Get a weekly plan you can edit as life happens. A starting point, with you in control.</p></article></div></section><section class="home-bottom"><div><h2>${state.schedule ? 'Your next better day is waiting.' : 'A calmer week starts here.'}</h2>${state.schedule ? '<p>Your routine is saved in this browser. Pick up where you left off.</p>' : ''}</div>${primaryCTA()}</section></div>`;
}
function openQuestionnaire() {
  if (state.draft) return navigate('questionnaire');
  if (state.schedule) return retakeDialog();
  state.draft = blankAnswers(); state.draftStep = 0; persist(); navigate('questionnaire');
}
function renderQuestionnaire() {
  main.innerHTML = '<div class="questionnaire-page" id="questionnaire-container"></div>';
  if (!state.draft) {
    if (state.schedule) {
      main.innerHTML = `<section class="empty-state"><p class="eyebrow">A FRESH START</p><h1>Your routine can grow with you.</h1><p>Retake the questionnaire to build a new week. You can keep your existing fixed commitments.</p><button class="btn btn-primary" data-action="app-retake">Retake questionnaire ${icon('arrow')}</button><p><a class="text-button" href="#schedule">Back to my schedule</a></p></section>`;
      return;
    }
    state.draft = blankAnswers(); state.draftStep = 0; persist();
  }
  cleanupQuestionnaire = mountQuestionnaire($('#questionnaire-container'), {
    draft: state.draft, initialStep: state.draftStep, hasSchedule: Boolean(state.schedule),
    onSaveDraft: (answers, step) => { state.draft = answers; state.draftStep = step; return persist(); },
    onCancel: () => navigate('home'),
    onComplete: answers => {
      const schedule = generateSchedule(answers);
      state.answers = structuredClone(answers); state.schedule = schedule; state.draft = null; state.draftStep = 0;
      persist(); navigate('schedule'); toast('Your week is ready. Make it your own.');
    },
  });
}
const CHALLENGE_TIPS = {
  busy: ['Leave a little breathing room.', 'Open time is part of your plan. If your week feels full, try one small priority before adding more.'],
  consistent: ['Give your routine an anchor.', 'Try connecting an activity to a commitment you already keep, like a short walk after your last class.'],
  rest: ['Rest belongs on your calendar.', 'You don’t have to fill every gap. Keep a little time unplanned, and make room to pause when you need it.'],
};
function renderSchedule() {
  if (!state.schedule) {
    main.innerHTML = `<section class="empty-state">${icon('calendar', 42)}<p class="eyebrow">YOUR WEEK, WAITING TO HAPPEN</p><h1>A little room for a better day.</h1><p>Start with the questionnaire. We’ll turn your commitments and goals into a weekly routine you can make your own.</p>${primaryCTA()}</section>`;
    return;
  }
  const personal = state.schedule.events.filter(event => event.type === 'activity').length;
  const commitments = state.schedule.events.filter(event => event.type === 'commitment').length;
  const [tipHeading, tipBody] = CHALLENGE_TIPS[state.answers.challenge] || ['Small steps make space.', 'A routine is a starting point. Try your week, notice what works, and adjust it as you go.'];
  main.innerHTML = `<div class="schedule-page"><header class="page-top"><div><p class="eyebrow">A LITTLE STRUCTURE, A LITTLE MORE YOU</p><h1>Your week, with room to breathe.</h1><p>A repeating weekly routine. Adjust the details to make it feel like yours.</p></div><div class="top-actions"><button class="btn btn-secondary" data-action="app-retake">Retake questionnaire</button><button class="btn btn-primary" data-action="app-add-event">${icon('plus', 16)} Add event</button></div></header><div class="schedule-layout"><section class="calendar-panel" aria-label="Your weekly schedule"><div class="calendar-toolbar"><div><h2>Your weekly rhythm</h2><small>Monday – Sunday · repeats each week</small></div><div class="view-toggle" role="group" aria-label="Schedule view"><button data-action="app-view" data-view="week" class="${view === 'week' ? 'active' : ''}" aria-pressed="${view === 'week'}">Week</button><button data-action="app-view" data-view="day" class="${view === 'day' ? 'active' : ''}" aria-pressed="${view === 'day'}">Day</button></div></div>${view === 'week' ? weekCalendar() : dayAgenda()}<div class="calendar-legend"><span><i class="legend-dot"></i>Commitments</span><span><i class="legend-dot activity"></i>Time for you</span>${view === 'week' ? '<span><i class="legend-dot sleep"></i>Sleep</span>' : ''}<span class="legend-hint">Select an event to edit</span></div></section><aside class="schedule-sidebar" aria-label="Your routine at a glance"><section class="sidebar-card"><h2>A little balance</h2><div class="summary-stats"><div class="summary-stat"><div class="summary-number">${personal}</div><div class="summary-label">personal sessions</div></div><div class="summary-stat"><div class="summary-number">${commitments}</div><div class="summary-label">commitments</div></div></div><p>Your time is yours. Any space left open stays that way.</p></section><section class="sidebar-card tip-card"><div class="tip-icon">${icon('leaf', 26)}</div><p class="eyebrow">A GENTLE REMINDER</p><h2>${tipHeading}</h2><p>${tipBody}</p></section>${state.schedule.unplaced.length ? `<section class="sidebar-card"><h2>Still looking for a little space</h2><ul class="unplaced-list">${state.schedule.unplaced.map(item => `<li><strong>${escape(item.title)}</strong><span>${item.requested - item.placed} of ${item.requested} ${item.requested === 1 ? 'session' : 'sessions'} not scheduled</span></li>`).join('')}</ul><p>Try changing the duration or available days in a new questionnaire.</p></section>` : ''}<section class="sidebar-card"><h2>A change of plans?</h2><p>Start a fresh questionnaire whenever you like. Keep your fixed commitments, or begin with a clean slate.</p><button class="btn btn-secondary" data-action="app-retake">${state.draft ? 'Continue questionnaire' : 'Build a new routine'} ${icon('arrow', 15)}</button>${state.draft ? '<button class="text-button sidebar-link" data-action="app-start-fresh">Start a new questionnaire instead</button>' : ''}</section></aside></div><p class="schedule-note">${icon('check', 12)} Saved in this browser on this device. Suggested activities include 10-minute transition gaps; manual edits can change them.</p>${state.schedule.notes.length ? `<ul class="notice-list">${state.schedule.notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}</div>`;
  if (view === 'week') {
    const firstStart = Math.min(...state.schedule.events.map(event => toMinutes(event.start)), 480);
    const scroll = $('.calendar-scroll');
    scroll.scrollTop = Math.max(0, (firstStart - 60));
  }
}
function weekCalendar() {
  const sleepShades = day => {
    const sleep = state.answers.sleep.overrides?.[day] || state.answers.sleep;
    const wake = toMinutes(sleep.wake), bed = toMinutes(sleep.bed);
    const blocks = wake < bed ? [[0, wake], [bed, 1440]] : [[bed, wake]];
    return blocks.filter(([start, end]) => end > start).map(([start, end]) => `<div class="sleep-shade" style="top:${start}px;height:${end - start}px" aria-hidden="true"></div>`).join('');
  };
  return `<div class="calendar-scroll" tabindex="0" aria-label="Weekly calendar, scroll for all hours and days"><div class="week-calendar"><div class="week-head"><div></div>${DAYS.map((day, index) => `<div class="${index === selectedDay ? 'today' : ''}">${day.slice(0, 3)}</div>`).join('')}</div><div class="calendar-body"><div class="time-axis" style="height:1440px">${Array.from({ length: 24 }, (_, hour) => `<span class="time-label" style="top:${hour * 60}px">${hour === 0 ? '' : hour % 12 || 12}${hour ? (hour < 12 ? 'a' : 'p') : ''}</span>`).join('')}</div>${DAYS.map((day, index) => `<div class="calendar-day" style="height:1440px" aria-label="${day}">${sleepShades(index)}${state.schedule.events.filter(event => event.day === index).map(event => {
    const duration = toMinutes(event.end) - toMinutes(event.start);
    return `<button class="cal-event type-${event.type} category-${escape(event.category)} ${duration < 35 ? 'short' : ''}" style="top:${toMinutes(event.start)}px;height:${duration}px" data-action="app-edit-event" data-id="${escape(event.id)}" aria-label="Edit ${escape(event.title)}, ${day}, ${formatTime(event.start)} to ${formatTime(event.end)}" title="${escape(event.title)} · ${formatTime(event.start)} – ${formatTime(event.end)}"><strong>${escape(event.title)}</strong><small>${formatTime(event.start).replace(' ', '')}</small></button>`;
  }).join('')}</div>`).join('')}</div></div></div>`;
}
function dayAgenda() {
  const events = state.schedule.events.filter(event => event.day === selectedDay).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  return `<div class="agenda-day-nav" role="group" aria-label="Choose a day">${DAYS.map((day, index) => `<button data-action="app-day" data-day="${index}" class="${index === selectedDay ? 'active' : ''}" aria-pressed="${index === selectedDay}" aria-label="${day}">${day.slice(0, 3)}</button>`).join('')}</div><div class="agenda-list"><p class="agenda-heading">${DAYS[selectedDay]} · ${events.length} ${events.length === 1 ? 'event' : 'events'}</p>${events.length ? events.map(event => `<button class="agenda-event type-${event.type}" data-action="app-edit-event" data-id="${escape(event.id)}" aria-label="Edit ${escape(event.title)}"><span>${formatTime(event.start)}<br>${formatTime(event.end)}</span><div><strong>${escape(event.title)}</strong><small>${event.type === 'commitment' ? 'Fixed commitment' : 'Time for you'} · ${toMinutes(event.end) - toMinutes(event.start)} min</small></div>${icon('edit', 16)}</button>`).join('') : '<div class="agenda-empty">A little open space.<br>Add an event, or leave room for life.</div>'}</div>`;
}
function render() {
  if (cleanupQuestionnaire) { cleanupQuestionnaire(); cleanupQuestionnaire = null; }
  const route = routeName();
  header(route);
  if (route === 'questionnaire') renderQuestionnaire();
  else if (route === 'schedule') renderSchedule();
  else renderHome();
  document.title = `${route === 'questionnaire' ? 'Create your routine' : route === 'schedule' ? 'My schedule' : 'Your better day starts now'} — BetterDay`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function showDialog(content) {
  dialogFocus = document.activeElement;
  dialog.innerHTML = `<div class="dialog-inner">${content}</div>`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { dialog.close(); }
dialog.addEventListener('close', () => { if (dialogFocus?.isConnected) dialogFocus.focus(); });
function dialogHead(title) {
  return `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-btn" data-action="app-close" aria-label="Close dialog">${icon('close', 17)}</button></div>`;
}
function retakeDialog(force = false) {
  if (state.draft && !force) return navigate('questionnaire');
  showDialog(`${dialogHead('A fresh start, your way.')}<p>Build a new routine from the beginning. Your current schedule stays available until you finish and create its replacement.</p>${state.draft ? '<p>You have an unfinished questionnaire. Starting fresh will replace those draft answers.</p>' : ''}<label class="check-label"><input id="keep-commitments" type="checkbox" checked>Keep my current fixed commitments${state.answers ? ` (${state.answers.commitments.length})` : ''}</label><p class="dialog-help">Wake-up times, goals, and preferences will start fresh. Your current schedule’s manual activity edits won’t carry into the new plan.</p><div class="dialog-actions"><button class="btn btn-secondary" data-action="app-close">Cancel</button><button class="btn btn-primary" data-action="app-confirm-retake">Start questionnaire ${icon('arrow', 16)}</button></div>`);
}
function eventEditor(eventId = null) {
  const event = eventId ? state.schedule.events.find(item => item.id === eventId) : null;
  if (eventId && !event) return;
  const values = event || { title: '', day: selectedDay, start: '', end: '', type: 'activity' };
  showDialog(`${dialogHead(event ? 'A little adjustment.' : 'Make a little space.')}<p>${event ? 'Edit this event in your repeating weekly routine. Changes apply to this occurrence only.' : 'Add an event to your repeating weekly routine.'}</p><form id="event-form" data-event-id="${escape(eventId || '')}"><label class="field"><span>Event name</span><input name="title" value="${escape(values.title)}" maxlength="100" placeholder="e.g. Practice flute" required autofocus></label><div class="form-grid"><label class="field"><span>Day</span><select name="day">${DAYS.map((day, index) => `<option value="${index}" ${index === values.day ? 'selected' : ''}>${day}</option>`).join('')}</select></label><label class="field"><span>Event type</span><select name="type" ${event ? 'disabled' : ''}><option value="activity" ${values.type === 'activity' ? 'selected' : ''}>Time for you</option><option value="commitment" ${values.type === 'commitment' ? 'selected' : ''}>Fixed commitment</option></select></label></div><div class="form-grid"><label class="field"><span>Starts</span><input name="start" type="time" value="${values.start}" required></label><label class="field"><span>Ends</span><input name="end" type="time" value="${values.end === '24:00' ? '00:00' : values.end}" required></label></div><p class="dialog-help">An end time of midnight means the end of the selected day. Events must fit outside sleep and other events. Split overnight events across two days.</p><p class="inline-error" id="event-error" role="alert" tabindex="-1"></p><div class="dialog-actions">${event ? `<button type="button" class="btn btn-quiet delete-action" data-action="app-delete-prompt" data-id="${escape(event.id)}">Delete event</button>` : ''}<button type="button" class="btn btn-secondary" data-action="app-close">Cancel</button><button type="submit" class="btn btn-primary">${event ? 'Save changes' : 'Add event'}</button></div><div id="delete-confirmation"></div></form>`);
}
function synchronizeCommitments() {
  const groups = new Map();
  state.schedule.events.filter(event => event.type === 'commitment').forEach(event => {
    const key = JSON.stringify([event.title, event.start, event.end]);
    if (!groups.has(key)) groups.set(key, { id: uid(), title: event.title, start: event.start, end: event.end, days: [] });
    const group = groups.get(key);
    group.days.push(event.day);
    event.sourceId = group.id;
  });
  state.answers.commitments = [...groups.values()].map(item => ({ ...item, days: item.days.sort((a, b) => a - b) }));
}
function refreshScheduleStatus() {
  state.schedule.events.sort((a, b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start));
  state.schedule.unplaced = state.answers.activities.map(activity => ({ activityId: activity.id, title: activity.title, requested: activity.frequency, placed: state.schedule.events.filter(event => event.type === 'activity' && event.sourceId === activity.id).length })).filter(item => item.placed < item.requested);
  state.schedule.notes = [];
  const windows = { morning: [360, 720], afternoon: [720, 1020], evening: [1020, 1440] };
  state.answers.activities.forEach(activity => {
    const window = windows[activity.preference];
    if (!window) return;
    const outside = state.schedule.events.filter(event => event.sourceId === activity.id && (toMinutes(event.start) < window[0] || toMinutes(event.end) > window[1])).length;
    if (outside) state.schedule.notes.push(`${outside} ${activity.title} ${outside === 1 ? 'session is' : 'sessions are'} outside your preferred ${activity.preference} window.`);
  });
}
document.addEventListener('submit', event => {
  if (event.target.id !== 'event-form') return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const existing = state.schedule.events.find(item => item.id === form.dataset.eventId);
  const values = { ...existing, id: existing?.id || uid(), title: data.get('title').trim(), day: Number(data.get('day')), start: data.get('start'), end: data.get('end'), type: existing?.type || data.get('type'), category: existing?.category || (data.get('type') === 'commitment' ? 'commitment' : 'custom'), sourceId: existing?.sourceId || null, preferred: true };
  if (values.end === '00:00' && values.start > '00:00') values.end = '24:00';
  const error = validateEvent(values, state.schedule.events, state.answers, { excludeId: existing?.id || null });
  if (error) { $('#event-error').textContent = error; $('#event-error').focus(); return; }
  if (existing) state.schedule.events = state.schedule.events.map(item => item.id === existing.id ? values : item);
  else state.schedule.events.push(values);
  if (values.type === 'commitment') synchronizeCommitments();
  refreshScheduleStatus(); persist(); closeDialog(); render(); toast(existing ? 'A little adjustment, saved.' : 'Your event is on the calendar.');
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (!action?.startsWith('app-')) return;
  event.preventDefault();
  if (action === 'app-questionnaire') openQuestionnaire();
  else if (action === 'app-how') $('#how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  else if (action === 'app-retake') retakeDialog();
  else if (action === 'app-start-fresh') retakeDialog(true);
  else if (action === 'app-confirm-retake') {
    state.draft = blankAnswers($('#keep-commitments').checked ? state.answers?.commitments || [] : []);
    state.draftStep = 0; persist(); closeDialog(); navigate('questionnaire');
  } else if (action === 'app-close') closeDialog();
  else if (action === 'app-add-event') eventEditor();
  else if (action === 'app-edit-event') eventEditor(button.dataset.id);
  else if (action === 'app-view') { view = button.dataset.view; renderSchedule(); $(`[data-action="app-view"][data-view="${view}"]`)?.focus({ preventScroll: true }); }
  else if (action === 'app-day') { selectedDay = Number(button.dataset.day); renderSchedule(); $(`[data-action="app-day"][data-day="${selectedDay}"]`)?.focus({ preventScroll: true }); }
  else if (action === 'app-delete-prompt') {
    $('#delete-confirmation').innerHTML = `<div class="delete-confirm" role="alert">Delete this occurrence from your weekly routine?<br><button type="button" class="btn btn-danger btn-small" data-action="app-delete-event" data-id="${escape(button.dataset.id)}">Yes, delete event</button> <button type="button" class="btn btn-quiet btn-small" data-action="app-cancel-delete">Keep event</button></div>`;
  } else if (action === 'app-cancel-delete') $('#delete-confirmation').innerHTML = '';
  else if (action === 'app-delete-event') {
    const deleted = state.schedule.events.find(item => item.id === button.dataset.id);
    state.schedule.events = state.schedule.events.filter(item => item.id !== button.dataset.id);
    if (deleted?.type === 'commitment') synchronizeCommitments();
    refreshScheduleStatus(); persist(); closeDialog(); render(); toast('Event removed. A little space opened up.');
  }
});
window.addEventListener('hashchange', render);
render();
