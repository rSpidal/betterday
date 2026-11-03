import { DAYS, formatTime, generateSchedule } from './scheduler.js';
import { mountQuestionnaire } from './questionnaire.js?v=20261102.2';
import { blankAnswers, loadState, saveState } from './storage.js';
import { bindTimePickers } from './time-picker.js?v=20261102.2';
import { mountPlanner } from './planner-view.js?v=20261102.2';
import { loadPlanner, saveRoutineReplacement } from './planner-storage.js?v=20261102';
import { replaceRoutine, todayInZone, getEventsForDate, routineCommitments } from './planner.js?v=20261102';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, size = 18) => {
  const paths = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    leaf: '<path d="M19 4C7 3 3 8 5 15c7 4 15 0 14-11Z"/><path d="m4 21 11-12"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
};
// Resolve any interrupted routine replacement before reading its weekly counterpart.
const initialPlanner = loadPlanner();
const loaded = loadState();
let state = loaded.state;
// An untouched empty form does not need a resume prompt on the home page.
if (state.draft && !state.draft.sleep.wake && !state.draft.sleep.bed &&
    !Object.keys(state.draft.sleep.overrides).length && !state.draft.commitments.length &&
    !state.draft.activities.length && !state.draft.challenge && !Object.keys(state.draft.timeDrafts || {}).length) {
  state.draft = null;
  state.draftStep = 0;
}
let cleanupQuestionnaire;
let cleanupPlanner;
let toastTimer;
let dialogFocus;
const main = $('#main-content');
const dialog = $('#app-dialog');
bindTimePickers(dialog);

function storageNotice(message) {
  const notice = $('#storage-notice');
  notice.textContent = message;
  notice.hidden = !message;
}
if (loaded.error || initialPlanner.error) storageNotice([loaded.error, initialPlanner.error].filter(Boolean).join(' '));
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
function scheduleStatus() {
  const planner = loadPlanner();
  return { hasSchedule: Boolean(state.schedule || planner.state), needsRecovery: Boolean(planner.error && !planner.state) };
}
function header(route) {
  const { hasSchedule, needsRecovery } = scheduleStatus();
  const openPlanner = hasSchedule || needsRecovery;
  const darkTheme = localStorage.getItem('betterday-theme') === 'dark';
  $('#main-nav').innerHTML = `<a href="#home" ${route === 'home' ? 'aria-current="page"' : ''}>Home</a><a class="nav-questionnaire" href="#questionnaire" data-action="app-questionnaire" ${route === 'questionnaire' ? 'aria-current="page"' : ''}>${state.draft ? 'Continue setup' : 'Questionnaire'}</a><a class="nav-cta" href="${openPlanner ? '#schedule' : '#questionnaire'}" ${!openPlanner ? 'data-action="app-questionnaire"' : ''} ${route === 'schedule' ? 'aria-current="page"' : ''}>${needsRecovery ? 'Recover planner' : hasSchedule ? 'My schedule' : 'Get started'}</a><button class="theme-toggle" type="button" data-action="app-theme-toggle" aria-pressed="${darkTheme}" aria-label="Switch to ${darkTheme ? 'light' : 'dark'} color scheme"><span aria-hidden="true">${darkTheme ? '☀' : '☾'}</span><span class="theme-toggle-label">${darkTheme ? 'Light' : 'Dark'} mode</span></button>`;
}
function primaryCTA(extra = '') {
  const { hasSchedule, needsRecovery } = scheduleStatus();
  const openPlanner = hasSchedule || needsRecovery;
  return `<a class="btn btn-primary ${extra}" href="${openPlanner ? '#schedule' : '#questionnaire'}" ${openPlanner ? '' : 'data-action="app-questionnaire"'}>${needsRecovery ? 'Recover my planner' : hasSchedule ? 'View my schedule' : state.draft ? 'Continue my questionnaire' : 'Create my schedule'}${icon('arrow')}</a>`;
}
function homePreview() {
  const sample = [
    { start: '09:00', end: '11:00', title: 'Classes & commitments', type: 'commitment' },
    { start: '12:30', end: '13:00', title: 'A little time outside', type: 'activity' },
    { start: '15:00', end: '16:00', title: 'Space for your goals', type: 'activity' },
  ];
  const planner = loadPlanner().state;
  const hasSavedSchedule = Boolean(planner || state.schedule);
  const plannerDate = planner ? todayInZone(planner.timeZone) : null;
  const localDay = (new Date().getDay() + 6) % 7;
  let previewDay = plannerDate ? (new Date(`${plannerDate}T12:00:00Z`).getUTCDay() + 6) % 7 : localDay;
  if (!planner && state.schedule && !state.schedule.events.some(event => event.day === previewDay)) previewDay = state.schedule.events[0]?.day ?? localDay;
  const events = planner ? getEventsForDate(planner, plannerDate).slice(0, 3) : state.schedule ? state.schedule.events.filter(event => event.day === previewDay).slice(0, 3) : sample;
  return `<div class="hero-art"><div class="preview-card"><div class="preview-top"><div><small>${hasSavedSchedule ? 'YOUR DAY, YOUR WAY' : 'AN EXAMPLE DAY'}</small><strong>${DAYS[hasSavedSchedule ? previewDay : 0]}, with room to breathe.</strong></div>${icon('leaf', 24)}</div><div class="preview-days" aria-hidden="true">${DAYS.map((day, index) => `<span class="${index === (hasSavedSchedule ? previewDay : 0) ? 'selected' : ''}">${day.charAt(0)}</span>`).join('')}</div>${events.length ? events.map(event => `<div class="preview-event"><span>${escape(formatTime(event.start))}</span><div><strong>${escape(event.title)}</strong><small>${escape(formatTime(event.start))} – ${escape(formatTime(event.end))}</small></div></div>`).join('') : '<div class="preview-event"><div><strong>A little open space.</strong><small>Your time is yours to shape.</small></div></div>'}</div><svg class="leaf-decoration" viewBox="0 0 130 160" fill="none" aria-hidden="true"><path d="M103 157C79 122 83 72 52 24" stroke="#567653" stroke-width="2"/><path d="M82 107C37 112 33 87 34 75c30-1 44 11 48 32Z" fill="#9fba92"/><path d="M77 82c32 0 43-24 36-44-31 6-39 23-36 44Z" fill="#7d9d70"/><path d="M63 52C34 52 24 31 28 12c24 4 38 20 35 40Z" fill="#b4c9a6"/><path d="M91 133c33-4 37-20 34-35-24 4-34 15-34 35Z" fill="#b0c6a1"/></svg></div>`;
}
function renderHome() {
  const { hasSchedule, needsRecovery } = scheduleStatus();
  main.innerHTML = `<div class="home"><section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-dot"></span>YOUR BETTER DAY STARTS NOW</p><h1>A little structure.<br>More room<br><em>for you.</em></h1><p class="hero-description">Make time for what matters. Set your priorities, find space around your commitments, and adjust your plan as the day unfolds.</p><div class="hero-actions">${primaryCTA()}<a class="btn btn-quiet" href="#how-it-works" data-action="app-how">How it works ${icon('arrow', 15)}</a></div></div>${homePreview()}</section><section id="how-it-works" aria-labelledby="how-heading"><div class="intro-strip"><h2 id="how-heading">Better days, by design.</h2><span class="rule"></span></div><div class="how-grid"><article class="how-item"><span class="how-number">01</span><h3>Start with your real life.</h3><p>Tell us about your usual day and the commitments already on your calendar.</p></article><article class="how-item"><span class="how-number">02</span><h3>Make time for what matters.</h3><p>Choose a few things you’d like more room for. We’ll find space around your schedule.</p></article><article class="how-item"><span class="how-number">03</span><h3>Find your own rhythm.</h3><p>Preview a plan for your tasks. As life changes, adjust the rest of your day—with you in control.</p></article></div></section><section class="home-bottom"><div><h2>${needsRecovery ? 'Let’s recover your saved plan.' : hasSchedule ? 'Your next better day is waiting.' : 'A calmer week starts here.'}</h2>${hasSchedule && !needsRecovery ? '<p>Your plan is saved in this browser. Pick up where you left off.</p>' : ''}</div><div>${primaryCTA()}${!hasSchedule && !needsRecovery ? '<p><a class="text-button" href="#schedule">Restore a saved planner</a></p>' : ''}</div></section></div>`;
}
function openQuestionnaire() {
  if (state.draft) return navigate('questionnaire');
  const { hasSchedule, needsRecovery } = scheduleStatus();
  if (needsRecovery) return navigate('schedule');
  if (hasSchedule) return retakeDialog();
  state.draft = blankAnswers(); state.draftStep = 0; persist(); navigate('questionnaire');
}
function renderQuestionnaire() {
  main.innerHTML = '<div class="questionnaire-page" id="questionnaire-container"></div>';
  if (!state.draft) {
    if (scheduleStatus().needsRecovery) {
      navigate('schedule');
      return;
    }
    if (scheduleStatus().hasSchedule) {
      main.innerHTML = `<section class="empty-state"><p class="eyebrow">A FRESH START</p><h1>Your routine can grow with you.</h1><p>Retake the questionnaire to build a new week. You can keep your existing fixed commitments.</p><button class="btn btn-primary" data-action="app-retake">Retake questionnaire ${icon('arrow')}</button><p><a class="text-button" href="#schedule">Back to my schedule</a></p></section>`;
      return;
    }
    state.draft = blankAnswers(); state.draftStep = 0; persist();
  }
  cleanupQuestionnaire = mountQuestionnaire($('#questionnaire-container'), {
    draft: state.draft, initialStep: state.draftStep, hasSchedule: scheduleStatus().hasSchedule,
    onSaveDraft: (answers, step) => { state.draft = answers; state.draftStep = step; return persist(); },
    onCancel: () => navigate('home'),
    onComplete: answers => {
      const schedule = generateSchedule(answers);
      const currentPlanner = loadPlanner();
      if (currentPlanner.error) {
        storageNotice(currentPlanner.error);
        throw new Error('Your saved planner needs attention before its routine can be replaced. Your questionnaire is still available; open My schedule to recover your planner.');
      }
      // Prepare both versions before changing memory or clearing the saved draft.
      const candidate = { ...state, answers: structuredClone(answers), schedule, draft: null, draftStep: 0 };
      if (currentPlanner.state) {
        const updated = replaceRoutine(currentPlanner.state, candidate, { startDate: todayInZone(currentPlanner.state.timeZone) });
        const result = saveRoutineReplacement(candidate, updated);
        if (!result.saved) {
          storageNotice(result.error);
          throw new Error(result.error || 'Your new routine could not be saved. Your questionnaire and previous plan have been kept.');
        }
      } else if (!saveState(candidate)) {
        throw new Error('This browser could not save your new routine. Your questionnaire is still open, and your previous routine has not been replaced.');
      }
      state = candidate;
      storageNotice('');
      navigate('schedule');
      toast(currentPlanner.state ? 'Your weekly routine is updated. Your dated plans and progress are kept.' : 'Your routine is saved. Choose its starting date to open your day planner.');
    },
  });
}
function renderSchedule() {
  // The dated planner owns migration, empty setup, backup restore, and recovery.
  cleanupPlanner = mountPlanner(main, {
    legacy: state,
    onRoutine: () => retakeDialog(),
    onNotice: storageNotice,
    onToast: toast,
    onChange: () => header(routeName()),
  });
}
function applyTheme(theme) {
  const darkTheme = theme === 'dark';
  document.documentElement.dataset.theme = darkTheme ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', darkTheme ? '#101b15' : '#f7f7ef');
}
applyTheme(localStorage.getItem('betterday-theme') || 'light');

function render() {
  if (dialog.open) dialog.close();
  dialog.classList.remove('planner-dialog-wide');
  if (cleanupQuestionnaire) { cleanupQuestionnaire(); cleanupQuestionnaire = null; }
  if (cleanupPlanner) { cleanupPlanner(); cleanupPlanner = null; }
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
  const currentPlanner = loadPlanner();
  if (currentPlanner.error) { storageNotice(currentPlanner.error); return navigate('schedule'); }
  const commitmentCount = currentPlanner.state ? routineCommitments(currentPlanner.state).length : state.answers?.commitments.length || 0;
  showDialog(`${dialogHead('A fresh start, your way.')}<p>Build a new routine from the beginning. Your current schedule stays available until you finish and save its replacement.</p>${state.draft ? '<p>You have an unfinished questionnaire. Starting fresh will replace those draft answers.</p>' : ''}<label class="check-label"><input id="keep-commitments" type="checkbox" checked>Keep my current weekly commitments (${commitmentCount})</label><p class="dialog-help">Wake-up times, goals, and preferences will start fresh. The new weekly pattern applies from today; separately added dated appointments and tasks remain in your planner.</p><div class="dialog-actions"><button class="btn btn-secondary" data-action="app-close">Cancel</button><button class="btn btn-primary" data-action="app-confirm-retake">Start questionnaire ${icon('arrow', 16)}</button></div>`);
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (!action?.startsWith('app-')) return;
  event.preventDefault();
  if (action === 'app-theme-toggle') {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('betterday-theme', theme);
    applyTheme(theme);
    header(routeName());
  } else if (action === 'app-questionnaire') openQuestionnaire();
  else if (action === 'app-how') $('#how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  else if (action === 'app-retake') retakeDialog();
  else if (action === 'app-start-fresh') retakeDialog(true);
  else if (action === 'app-confirm-retake') {
    const currentPlanner = loadPlanner();
    if (currentPlanner.error) { storageNotice(currentPlanner.error); closeDialog(); navigate('schedule'); return; }
    const commitments = currentPlanner.state ? routineCommitments(currentPlanner.state) : state.answers?.commitments || [];
    state.draft = blankAnswers($('#keep-commitments').checked ? commitments : []);
    state.draftStep = 0; persist(); closeDialog(); navigate('questionnaire');
  } else if (action === 'app-close') closeDialog();

});
window.addEventListener('hashchange', render);
render();
