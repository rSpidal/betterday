import * as P from './planner.js?v=20261103.10';
import { getCommitmentDetails, saveWeeklyCommitment, deleteCommitmentGroup, firstCommitmentDate } from './commitments.js?v=20261103.10';
import { loadPlanner, savePlanner, saveMigratedPlanner, importPlannerBackup } from './planner-storage.js?v=20261102';
import { formatTime, toMinutes, DAYS } from './scheduler.js';
import { renderTimePicker } from './time-picker.js?v=20261102.2';
import { parseCalendar, exportCalendar, mergeCalendarEvents } from './calendar-exchange.js?v=20261102';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const clone = value => structuredClone(value);
const dayIndex = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const dateLabel = (date, short = false) => new Intl.DateTimeFormat('en-US', { timeZone:'UTC', weekday:short ? 'short' : 'long', month:'short', day:'numeric' }).format(new Date(`${date}T12:00:00Z`));
const minutesLabel = n => n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` : `${n} min`;
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
const select = (label, name, value, options) => `<label class="field"><span>${label}</span><select name="${name}">${options.map(([id,title])=>`<option value="${esc(id)}" ${String(value)===String(id)?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
const action = (name, label, extra = '', classes = 'btn btn-secondary') => `<button type="button" class="${classes}" data-plan="${name}" ${extra}>${label}</button>`;
const times = event => `${formatTime(event.start)} – ${event.end==='24:00'?'Midnight':formatTime(event.end)}`;

/** Dated planner UI. All schedule-changing operations go through the pure engine. */
export function mountPlanner(container, {legacy, onRoutine, onNotice = () => {}, onToast = () => {}, onChange = () => {}} = {}) {
  const loaded = loadPlanner();
  let state = loaded.state;
  let selectedDate = P.todayInZone(state?.timeZone);
  let view = window.innerWidth <= 760 ? 'day' : 'week';
  let taskTab = 'active';
  let pending = null;
  let importGeneration = 0;
  let mounted = true;
  let dialogFocus;
  let nextCommitmentRow = 0;
  const dialog = document.querySelector('#app-dialog');
  if (loaded.error) onNotice(loaded.error);

  function commit(next, message = '') {
    if (!savePlanner(next)) throw new Error('Your change could not be saved in this browser. Your previous plan is unchanged. Download a backup and free some browser storage before trying again.');
    state = next;
    onChange(state);
    close(); render(); if (message) onToast(message);
  }
  function show(title, content, wide = false) {
    if (!dialog.open) dialogFocus = document.activeElement;
    dialog.classList.toggle('planner-dialog-wide', wide);
    dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><h2 id="dialog-title" tabindex="-1">${title}</h2>${action('close','×','aria-label="Close dialog"','icon-btn')}</div>${content}<p class="inline-error" id="planner-error" role="alert" tabindex="-1"></p></div>`;
    if (!dialog.open) dialog.showModal();
    else (dialog.querySelector('[autofocus]') || dialog.querySelector('#dialog-title')).focus();
  }
  function close() { importGeneration++; if (dialog.open) dialog.close(); dialog.classList.remove('planner-dialog-wide'); pending = null; }
  function report(error) {
    const target = dialog.open ? dialog.querySelector('#planner-error') : container.querySelector('#planner-status');
    if (target) { target.textContent = error?.message || String(error); target.hidden = false; target.focus(); }
    else onNotice(error?.message || String(error));
  }
  function dateNow(date = selectedDate) {
    const today = P.todayInZone(state.timeZone);
    return date < today ? 1440 : date === today ? P.nowMinutesInZone(state.timeZone) : 0;
  }
  function initView() {
    if (loaded.error) {
      container.innerHTML = `<section class="empty-state"><h1>Your saved planner needs attention.</h1><p>${esc(loaded.error)}</p><p>Your original data has been kept. Download it before attempting recovery.</p>${action('backup','Download saved data')}${action('restore','Restore a backup')}</section>`;
      return;
    }
    const hasRoutine = Boolean(legacy?.schedule && legacy?.answers);
    container.innerHTML = `<section class="planner-setup"><p class="eyebrow">${hasRoutine ? 'YOUR NEXT CHAPTER' : 'GET STARTED'}</p><h1>${hasRoutine ? 'Give your routine a real date.' : 'Start with a blank calendar.'}</h1><p>${hasRoutine ? 'Keep your existing commitments and turn your activities into tasks you can plan, complete, and move as the day changes.' : 'Add commitments and tasks as you go. The questionnaire is optional, and you can use it later.'}</p><form id="planner-setup-form">${hasRoutine ? field('Start this routine on','startDate',P.weekStart(selectedDate),'date','required') : `<input type="hidden" name="startDate" value="${selectedDate}">`}${field('Time zone','timeZone',Intl.DateTimeFormat().resolvedOptions().timeZone,'text','required list="planner-zones"')}<datalist id="planner-zones">${['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney','UTC'].map(x=>`<option value="${x}">`).join('')}</datalist><p class="field-hint">${hasRoutine ? 'Your weekly commitments will repeat from this date. Your original routine is kept as a backup in this browser.' : 'Task planning starts with 7 AM–11 PM available. You can adjust these hours in Sleep & wake.'}</p><button class="btn btn-primary" type="submit">${hasRoutine ? 'Open my day planner' : 'Open calendar'} →</button></form>${!hasRoutine ? `<p>${legacy?.draft ? 'Your unfinished questionnaire is saved.' : 'Prefer guided setup?'} <a class="text-button" href="#questionnaire" data-action="app-questionnaire">${legacy?.draft ? 'Continue questionnaire' : 'Use questionnaire'}</a></p>` : ''}<p>Already have a saved planner?</p>${action('restore','Restore a backup')}</section>`;
  }
  function render() {
    if (!state) return initView();
    const today = P.todayInZone(state.timeZone);
    const list = P.getEventsForDate(state, selectedDate);
    const tasks = P.tasksForDate(state, selectedDate, {includeCompleted:true});
    const active = tasks.filter(t=>t.status==='active');
    const next = list.find(e=>toMinutes(e.end)>dateNow() && e.kind==='session');
    const sleep = P.sleepForDate(state, selectedDate);
    container.innerHTML = `<div class="schedule-page planner-page"><header class="page-top"><div><p class="eyebrow">YOUR DAY, AS IT UNFOLDS</p><h1>${selectedDate===today?'Make room for today.':'A day with room to breathe.'}</h1><p>${dateLabel(selectedDate)} · ${esc(state.timeZone.replaceAll('_',' '))}</p></div><div class="top-actions">${action('event-new','+ Add commitment')}${action('task-new','+ Add task','','btn btn-primary')}</div></header>
      <p id="planner-status" class="inline-error" role="alert" tabindex="-1" hidden></p>
      <div class="planner-datebar"><div class="date-controls">${action('previous','←','aria-label="Previous day"','icon-btn')}<label class="sr-only" for="plan-date">Planning date</label><input id="plan-date" type="date" value="${selectedDate}" aria-label="Planning date">${action('next','→','aria-label="Next day"','icon-btn')}${action('today','Today','','text-button')}</div><div class="planner-tools">${action('sleep','Sleep & wake')}${action('exchange','Import / export')}${action('undo','Undo',''+(!state.undo?' disabled':''))}</div></div>
      <section class="now-card" aria-label="Your next step"><div><p class="eyebrow">${selectedDate===today?'FROM HERE':'THE PLAN AHEAD'}</p><h2>${next?esc(next.title):active.some(t=>t.eligible)?'Find a little space for what matters.':'A little breathing room.'}</h2><p>${next?`${times(next)} · ${toMinutes(next.start)<=dateNow()?'Work session in progress':'Your next planned work session'}`:active.some(t=>t.eligible)?'We’ll suggest times for your tasks around your fixed commitments.':'Add a task or leave some time open. You’re in control.'}</p></div><div class="now-actions">${selectedDate===today?action('awake',state.wakeLog[selectedDate]?`Awake at ${formatTime(state.wakeLog[selectedDate])}`:'I’m awake') : ''}${action('replan','Preview my plan →',selectedDate<today?'disabled':'','btn btn-primary')}</div></section>
      <div class="planner-layout"><section class="calendar-panel"><div class="calendar-toolbar"><div><h2>${view==='week'?'Your week':'Your day'}</h2><small>Fixed commitments stay in place · tasks can move</small></div><div class="view-toggle" role="group" aria-label="Schedule view">${['day','week'].map(v=>action('view',v==='day'?'Day':'Week',`data-view="${v}" aria-pressed="${view===v}"`,view===v?'active':'')).join('')}</div></div>${view==='week'?weekView():agenda(list)}<div class="calendar-legend"><span><i class="legend-dot"></i>Commitments</span><span><i class="legend-dot activity"></i>Work sessions</span><span>Sleep: ${formatTime(sleep.bed)} – ${formatTime(sleep.wakeLatest||sleep.wake)}</span></div></section>
      <aside class="task-panel"><div class="task-panel-heading"><div><h2>Your tasks</h2></div>${action('task-new','+','aria-label="Add a task"','icon-btn')}</div><div class="task-tabs" role="group" aria-label="Task list">${action('tab',`Active (${active.length})`,'data-tab="active" aria-pressed="'+(taskTab==='active')+'"',taskTab==='active'?'active':'')}${action('tab','Completed','data-tab="completed" aria-pressed="'+(taskTab==='completed')+'"',taskTab==='completed'?'active':'')}</div><div class="task-list">${taskTab==='completed'?completedView(tasks):active.length?active.map((t,i)=>taskCard(t,i,active.length)).join(''):'<div class="tasks-empty"><h3>Start with one intention.</h3><p>Add what you want to do and how much time it needs. We’ll help you find a place for it.</p>'+action('task-new','Add your first task','','btn btn-primary')+'</div>'}</div></aside></div>
      <footer class="planner-footer"><p>Saved in this browser. A passing work session never marks a task complete.</p><div>${action('backup','Download backup','','text-button')}${action('restore','Restore backup','','text-button')}${action('routine',legacy?.draft ? 'Continue questionnaire' : P.hasWeeklyRoutine(legacy, state) ? 'Edit weekly routine' : 'Set up a weekly routine','','text-button')}</div></footer></div>`;

  }
  function agenda(events) {
    return `<div class="dated-agenda">${events.length?events.map(e=>`<button class="agenda-event type-${e.kind==='fixed'?'commitment':'activity'}" data-plan="event-edit" data-id="${esc(e.id)}"><span>${formatTime(e.start)}<br>${e.end==='24:00'?'Midnight':formatTime(e.end)}</span><div><strong>${esc(e.title)}</strong><small>${e.kind==='fixed'?'Fixed commitment':e.locked?'Locked work session':'Flexible work session'}${e.recurrence?' · Repeats':''} · ${minutesLabel(toMinutes(e.end)-toMinutes(e.start))}</small>${overlaps(e,events)?'<small class="conflict-label">Overlaps another event</small>':''}</div><span aria-hidden="true">↗</span></button>`).join(''):'<div class="agenda-empty">An open day.<br>Add a commitment or preview a plan for your tasks.</div>'}</div>`;
  }
  function overlaps(event, events) { return events.some(other=>other.id!==event.id&&toMinutes(event.start)<toMinutes(other.end)&&toMinutes(event.end)>toMinutes(other.start)); }
  function weekView() {
    const monday = P.weekStart(selectedDate);
    const dates = Array.from({length:7},(_,i)=>P.addDays(monday,i));
    const eventsByDay = dates.map(date => P.getEventsForDate(state,date));
    const allEvents = eventsByDay.flat();
    const firstHour = Math.min(6, ...allEvents.map(event => Math.floor(toMinutes(event.start) / 60)));
    const lastHour = Math.max(22, ...allEvents.map(event => Math.ceil(toMinutes(event.end) / 60)));
    const startMinute = firstHour * 60, endMinute = Math.min(24, lastHour) * 60, hourCount = endMinute / 60 - firstHour;
    const axis = Array.from({length:hourCount + 1},(_,i)=>`<span class="week-hour-label" style="top:${i*60}px">${formatTime(`${String(firstHour+i).padStart(2,'0')}:00`)}</span>`).join('');
    const headers = dates.map(date=>`<div class="week-head-cell ${date===selectedDate?'selected':''}"><button class="week-date" data-plan="pick-date" data-date="${date}" aria-pressed="${date===selectedDate}">${dateLabel(date,true)}</button></div>`).join('');
    const columns = dates.map((date,index)=>{
      const events=eventsByDay[index];
      return `<section class="week-column ${date===selectedDate?'selected':''}" style="height:${endMinute-startMinute}px">${events.map(event=>{
        const start=toMinutes(event.start), end=toMinutes(event.end), top=Math.max(0,start-startMinute), height=Math.max(0,Math.min(end,endMinute)-Math.max(start,startMinute));
        return `<button class="week-event ${event.kind==='fixed'?'fixed':''}" style="top:${top}px;height:${height}px" data-plan="event-edit" data-id="${esc(event.id)}" data-date="${date}" aria-label="${esc(event.title)}, ${times(event)}"><span>${formatTime(event.start)}</span><strong>${esc(event.title)}</strong>${overlaps(event,events)?'<small class="conflict-label">Overlap</small>':''}</button>`;
      }).join('')}</section>`;
    }).join('');
    return `<div class="dated-week-scroll"><div class="dated-week" style="--week-hours:${hourCount}"><div class="week-head"><div class="week-time-head">Time</div>${headers}</div><div class="week-body"><div class="week-time-axis" style="height:${endMinute-startMinute}px">${axis}</div>${columns}</div></div></div>`;
  }
  function taskCard(task,index,count) {
    return `<article class="task-item ${task.eligible?'':'deferred'}"><div class="task-heading"><span class="task-rank">${index+1}</span><button data-plan="task-edit" data-id="${esc(task.id)}" class="task-title">${esc(task.title)}</button>${action('done','✓',`data-id="${esc(task.id)}" aria-label="Complete ${esc(task.title)}"`,'complete-task')}</div><p>${minutesLabel(task.remaining)} remaining${task.deadline?` · Due ${dateLabel(task.deadline,true)}`:''}${task.recurrence?` · ${task.recurrence.frequency==='daily'?'Daily':'Weekly'}`:''}${task.split?' · Can split':''}</p>${task.reason?`<p class="field-hint">${esc(task.reason)}</p>`:''}<div class="task-actions">${action('rank','↑',`data-id="${esc(task.id)}" data-direction="-1" aria-label="Move ${esc(task.title)} up" ${index===0?'disabled':''}`,'text-button')}${action('rank','↓',`data-id="${esc(task.id)}" data-direction="1" aria-label="Move ${esc(task.title)} down" ${index===count-1?'disabled':''}`,'text-button')}${action('progress','Progress',`data-id="${esc(task.id)}"`,'text-button')}${action('defer','Defer',`data-id="${esc(task.id)}"`,'text-button')}</div></article>`;
  }
  function completedView() {
    const rows = P.completedTaskHistory(state);
    return rows.length?rows.map(t=>`<article class="task-item completed-task"><strong>✓ ${esc(t.title)}</strong><p>${t.date?dateLabel(t.date):'Completed'}</p></article>`).join(''):'<div class="tasks-empty"><p>Finished tasks will live here. Your progress deserves a place.</p></div>';
  }
  function taskForm(id) {
    const task = id ? state.tasks.find(t=>t.id===id) : null;
    const resolved = task && P.tasksForDate(state,selectedDate,{includeCompleted:true}).find(t=>t.id===id);
    show(task?'Shape this task.':'What would you like to do?',`<form id="planner-task-form" data-id="${esc(id||'')}">${field('Task name','title',task?.title||'','text','required maxlength="200" autofocus placeholder="e.g. Practice flute"')}<div class="form-grid">${field(task?'Time remaining (minutes)':'Time needed (minutes)','remaining',resolved?.remaining??task?.remaining??30,'number','min="1" max="525600" required')}${field('Priority · 1 is highest','priority',task?.priority??state.tasks.length+1,'number','min="1" max="100000" required')}</div><div class="form-grid">${field('Deadline (optional)','deadline',task?.deadline||'','date')}${select('Repeat','repeat',task?.recurrence?.frequency||'none',[['none','Does not repeat'],['daily','Every day'],['weekly','Weekly on '+(task?.recurrence?.days||[dayIndex(selectedDate)]).map(day=>DAYS[day]).join(', ')]])}</div><p class="field-hint">For repeating tasks, time remaining applies to this date. Other details apply to future occurrences too. Changing the repeat pattern starts a new pattern from this date and keeps completion history.</p><label class="checkbox-label"><input type="checkbox" name="split" ${task?.split?'checked':''}>Can split into shorter work sessions</label>${field('Shortest session (minutes)','minSession',task?.minSession||15,'number','min="1" max="1440" required')}<p class="dialog-help">We’ll place this task when you preview your plan. Priorities guide the order; deadlines and available time also matter.</p><div class="dialog-actions">${action('close','Cancel')}<button class="btn btn-primary" type="submit">Save task</button></div></form>`);
  }
  function commitmentTimeRow(slot, index) {
    const pair = `planner-commitment-${++nextCommitmentRow}`;
    return `<fieldset class="planner-commitment-time" data-commitment-time data-slot="${esc(JSON.stringify(slot))}">
      <legend data-time-heading>Time ${index + 1}</legend>
      <div class="commitment-time-actions">${action('commitment-time-remove','Remove time','','text-button')}</div>
      <fieldset class="day-fieldset" data-event-weekdays><legend>Repeat on</legend><div class="commitment-weekdays">${DAYS.map((day,i)=>`<label><input type="checkbox" name="weekdays" value="${i}" aria-label="${day}" ${slot.days.includes(i)?'checked':''}><span>${day.slice(0,3)}</span></label>`).join('')}</div></fieldset>
      <div class="form-grid">${renderTimePicker({label:'Starts',value:slot.start||'',name:'start',pair,endpoint:'start'})}${renderTimePicker({label:'Ends',value:slot.end||'',name:'end',pair,endpoint:'end',endOfDay:true})}</div>
    </fieldset>`;
  }
  function eventForm(id, date = selectedDate) {
    const event = id ? P.getEventsForDate(state,date).find(e=>e.id===id) : null;
    if (id && !event) throw new Error('This event is no longer on this date. Refresh the plan.');
    const noun = event?.kind === 'session' ? 'work session' : 'commitment';
    const repeat = event?.recurrence?.frequency || 'none';
    const details = event?.kind === 'fixed' && event.recurrence ? getCommitmentDetails(state,id,date) : null;
    const slots = details?.slots || [{id:`new-${++nextCommitmentRow}`,days:repeat==='weekly'?event.recurrence.days:[dayIndex(date)],start:event?.start||'',end:event?.end||'',until:event?.recurrence?.until||null}];
    const grouped = details && (details.masterIds.length > 1 || event.commitmentGroupId);
    show(event?`Edit ${noun}.`:'Add a commitment.',`<form id="planner-event-form" data-id="${esc(id||'')}" data-date="${date}" data-recurring="${Boolean(event?.recurrence)}" data-grouped="${Boolean(grouped)}" data-fixed="${event?.kind!=='session'}" data-weekdays-edited="${Boolean(event)}">
      ${field(event?.kind === 'session' ? 'Work session name' : 'Commitment name','title',event?.title||'','text','required maxlength="200" autofocus placeholder="e.g. Rehearsal"')}
      ${event?.recurrence?select('Apply change to','scope','this',[['this','Only this date'],['all','The whole commitment']]):''}
      <div class="form-grid">${field(event ? 'Date' : 'Start on or after','date',date,'date','required')}${select('Repeat','repeat',repeat,[['none','Does not repeat'],['daily','Every day'],['weekly','Every week']])}</div>
      <p class="field-hint" data-event-repeat-note hidden>To edit the weekly days and times together, choose “The whole commitment.”</p>
      ${event?.recurrence?`<fieldset class="commitment-occurrence" data-event-occurrence><legend class="sr-only">Time for this date</legend><div class="form-grid">${renderTimePicker({label:'Starts',value:event.start,name:'occurrenceStart',pair:'commitment-occurrence',endpoint:'start'})}${renderTimePicker({label:'Ends',value:event.end,name:'occurrenceEnd',pair:'commitment-occurrence',endpoint:'end',endOfDay:true})}</div></fieldset>`:''}
      <fieldset class="commitment-times" data-event-times><legend class="sr-only">Commitment times</legend><p class="field-hint" data-weekly-help>Select the days that share a time. Add another time when a day starts or ends differently.</p><div data-commitment-rows>${slots.map(commitmentTimeRow).join('')}</div>${action('commitment-time-add','+ Add another day and time','','btn btn-secondary')}</fieldset>
      ${event?.kind==='session'?`<label class="checkbox-label"><input name="locked" type="checkbox" ${event.locked?'checked':''}>Keep this work session at its chosen time</label>`:''}
      ${select('If this overlaps other events','conflict','move',[['move','Preview moving tasks on this date'],['reject','Keep other events fixed; show a conflict'],['allow','Keep both and show the overlap'],['replace','Replace a selected event']])}
      <div class="event-replacement" data-event-replacement hidden>${select('Event to replace','replaceId','',[['','Choose an event']])}</div>
      <p class="dialog-help">Fixed commitments never move automatically. Midnight as an end means the end of this date. Split overnight commitments across two dates.</p>
      <div class="dialog-actions">${event?action('event-delete','Delete',`data-id="${esc(id)}" data-date="${date}"`,'btn btn-quiet delete-action'):''}${action('close','Cancel')}<button class="btn btn-primary" type="submit">Review ${noun}</button></div></form>`,true);
    const form=dialog.querySelector('#planner-event-form');
    syncEventRepeat(form); syncEventReplacement(form);
  }
  function onlyOccurrence(form) { return form.dataset.recurring === 'true' && form.elements.scope.value === 'this'; }
  function weeklyCommitment(form) { return !onlyOccurrence(form) && form.elements.repeat.value === 'weekly' && form.dataset.fixed === 'true'; }
  function commitmentSlots(form) {
    return [...form.querySelectorAll('[data-commitment-time]')].map(row=>({
      ...JSON.parse(row.dataset.slot),
      days:[...row.querySelectorAll('[name="weekdays"]:checked')].map(input=>Number(input.value)),
      start:row.querySelector('[name="start"]').value,end:row.querySelector('[name="end"]').value,
    }));
  }
  function syncEventRepeat(form) {
    const onlyThisDate = onlyOccurrence(form), weekly = form.elements.repeat.value === 'weekly';
    form.elements.repeat.disabled = onlyThisDate || form.dataset.grouped === 'true';
    form.elements.date.closest('label').querySelector('span').textContent = onlyThisDate ? 'Date' : form.dataset.recurring === 'true' && weekly ? 'Preview on or after' : form.dataset.id ? 'Date' : 'Start on or after';
    const occurrence = form.querySelector('[data-event-occurrence]');
    if (occurrence) { occurrence.hidden = !onlyThisDate; occurrence.disabled = !onlyThisDate; }
    const group = form.querySelector('[data-event-times]');
    group.hidden = onlyThisDate; group.disabled = onlyThisDate;
    const rows = [...group.querySelectorAll('[data-commitment-time]')];
    rows.forEach((row,index)=>{
      row.hidden = !weekly && index > 0; row.disabled = !weekly && index > 0;
      row.classList.toggle('weekly-time',weekly);
      row.querySelector('[data-time-heading]').textContent = `Time ${index + 1}`;
      row.querySelector('[data-time-heading]').hidden = !weekly;
      row.querySelector('.commitment-time-actions').hidden = !weekly || rows.length === 1;
      const days=row.querySelector('[data-event-weekdays]'); days.hidden=!weekly;days.disabled=!weekly;
    });
    group.querySelector('[data-plan="commitment-time-add"]').hidden = !weekly || form.dataset.fixed !== 'true';
    group.querySelector('[data-weekly-help]').hidden = !weekly;
    form.querySelector('[data-event-repeat-note]').hidden = !onlyThisDate;
  }
  function eventFormDate(form) {
    const date=form.elements.date.value;
    if(!P.isDate(date) || form.elements.repeat.value!=='weekly' || onlyOccurrence(form)) return date;
    return firstCommitmentDate(commitmentSlots(form),date);
  }
  function syncEventReplacement(form) {
    form.querySelector('[data-event-replacement]').hidden=form.elements.conflict.value!=='replace';
    const date=eventFormDate(form),previous=form.elements.replaceId.value;
    const existing=form.dataset.id ? P.getEventsForDate(state,form.dataset.date).find(event=>event.id===form.dataset.id) : null;
    const details=weeklyCommitment(form)&&existing ? getCommitmentDetails(state,existing.id,form.dataset.date) : null;
    const excludedIds=new Set(details?.masterIds||[existing?.masterId||existing?.id]);
    const events=P.isDate(date)?P.getEventsForDate(state,date).filter(event=>!excludedIds.has(event.masterId||event.id)):[];
    form.elements.replaceId.innerHTML=`<option value="">Choose an event</option>${events.map(event=>`<option value="${esc(event.id)}">${esc(event.title)} · ${formatTime(event.start)}</option>`).join('')}`;
    if(events.some(event=>event.id===previous)) form.elements.replaceId.value=previous;
  }
  function commitmentSummary(slots) {
    return `<ul class="commitment-summary">${slots.map(slot=>`<li><strong>${esc(slot.days.map(day=>DAYS[day]).join(', '))}</strong><br>${times(slot)}${slot.until?` · through ${dateLabel(slot.until)}`:''}</li>`).join('')}</ul>`;
  }
  function recurrenceSummary(values) {
    if (!values.recurrence) return '';
    const repeat = values.recurrence.frequency === 'daily' ? 'Every day' : 'Every ' + values.recurrence.days.map(day=>DAYS[day]).join(', ');
    return `${repeat}${values.recurrence.until ? ` through ${dateLabel(values.recurrence.until)}` : ''}.`;
  }
  function review(candidate = state, {title='A plan you can make your own.',intro='Review the proposed work sessions. Your fixed commitments and work already underway stay in place.', date=selectedDate,commitment=null} = {}) {
    if (date<P.todayInZone(state.timeZone)) throw new Error('Choose today or a future date to replan.');
    const preview = P.previewReplan(candidate,{date,nowMinutes:dateNow(date)});
    pending = {candidate,preview,original:state,date,commitment,createdAt:Date.now()};
    const changes = preview.changes || [];
    show(title,`<p>${esc(intro)}</p>${commitment?`<p><strong>${esc(commitment.title)}</strong></p>${commitmentSummary(commitment.slots)}<p>These weekly times will be saved together. Task adjustments below apply only to ${dateLabel(date)}.</p>`:''}<p class="preview-date">${dateLabel(date)} · ${preview.events.length} proposed work sessions</p><div class="plan-preview">${changes.length?changes.map(c=>`<article class="plan-change"><strong>${esc(c.title)}</strong><div><span>${c.before.length?c.before.map(times).join(', '):'Not scheduled'}</span><span aria-hidden="true">→</span><span>${c.after.length?c.after.map(times).join(', '):'Not placed'}</span></div><p>${esc(c.reason)}</p></article>`).join(''):'<p>Your existing plan already fits. There are no work-session changes.</p>'}</div>${preview.unplaced.length?`<section class="unplaced-preview"><h3>Still needs a little space</h3>${preview.unplaced.map(t=>`<p><strong>${esc(t.title)}</strong> · ${minutesLabel(t.minutes)}<br>${esc(t.reason)}</p>`).join('')}</section>`:''}${preview.notes?.length?`<ul class="notice-list">${preview.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}<p class="dialog-help">Nothing changes until you apply this plan. Undo restores the previous plan and any commitment or wake-up change included here.</p><div class="dialog-actions">${action('close','Keep current plan')}${action('apply','Apply this plan','','btn btn-primary')}</div>`,true);
  }
  function sleepForm() {
    const s = state.sleep;
    show('Your day has a rhythm.',`<form id="planner-sleep-form"><p>Give your usual wake-up and bedtime ranges. We plan from the latest wake-up to the earliest bedtime until you record when you’re actually awake.</p><div class="form-grid">${renderTimePicker({label:'Earliest wake-up',value:s.wake,name:'wake'})}${renderTimePicker({label:'Latest wake-up',value:s.wakeLatest||s.wake,name:'wakeLatest'})}</div><div class="form-grid">${renderTimePicker({label:'Earliest bedtime',value:s.bed,name:'bed'})}${renderTimePicker({label:'Latest bedtime',value:s.bedLatest||s.bed,name:'bedLatest'})}</div>${field('Minimum sleep (hours)','minSleep',s.minSleep/60,'number','min="0.5" max="23" step="0.5" required')}${Object.keys(state.sleepOverrides).length?'<label class="checkbox-label"><input type="checkbox" name="clearOverrides">Use these ranges every day, replacing day-specific sleep times</label>':''}<p class="dialog-help">Bedtime ranges may cross midnight. The minimum sleep you choose stays protected.</p><div class="dialog-actions">${action('close','Cancel')}<button type="submit" class="btn btn-primary">Save sleep preferences</button></div></form>`);
  }
  function awakeForm() {
    const now = P.nowMinutesInZone(state.timeZone);
    show('A fresh start from here.',`<form id="planner-awake-form"><p>When did you wake up today? We’ll preview adjustments to the remaining day.</p>${renderTimePicker({label:'Woke up at',name:'wake',value:state.wakeLog[selectedDate]||`${String(Math.floor(now/60)).padStart(2,'0')}:${String(now%60).padStart(2,'0')}`})}<div class="dialog-actions">${action('close','Cancel')}<button type="submit" class="btn btn-primary">Preview my updated day</button></div></form>`);
  }
  function exchangeForm() {
    show('Bring your calendars together.',`<p>Import or export a calendar file. These are snapshots; changes won’t sync automatically.</p><form id="planner-export-form"><div class="form-grid">${field('From','from',selectedDate,'date','required')}${field('Through','through',P.addDays(selectedDate,27),'date','required')}</div><div class="exchange-actions"><button class="btn btn-secondary" type="submit">Download calendar (.ics)</button><label class="btn btn-primary file-button">Choose calendar to import<input type="file" id="calendar-file" accept=".ics,text/calendar"></label></div><p class="dialog-help">Imports use this date range and ${esc(state.timeZone)}. You’ll review events and any unsupported items before adding them.</p></form><div class="dialog-actions">${action('close','Close')}</div>`,true);
  }
  function restoreForm() {
    show('Restore a saved planner.',`<p>Choose a BetterDay JSON backup. You’ll review its contents before replacing this planner. Your current plan remains available through Undo.</p><label class="btn btn-primary file-button">Choose backup file<input type="file" id="planner-backup-file" accept=".json,application/json"></label><div class="dialog-actions">${action('close','Cancel')}</div>`);
  }
  function snapshotEvents(from,through) {
    if (!P.isDate(from)||!P.isDate(through)||through<from) throw new Error('Choose a valid date range.');
    const days = Math.round((new Date(through+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000)+1;
    if(days>366) throw new Error('Choose a range of up to one year.');
    return Array.from({length:days},(_,i)=>P.getEventsForDate(state,P.addDays(from,i))).flat().map(e=>({...e,recurrence:null,excludedDates:[]}));
  }
  function download(text,name,type) {
    const url = URL.createObjectURL(new Blob([text],{type}));
    const a=document.createElement('a'); a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function onInput(event) {
    try {
      if(event.target.id==='plan-date') { if(P.isDate(event.target.value)){selectedDate=event.target.value;render();} }
      const eventForm = event.target.closest('#planner-event-form');
      if (eventForm && ['date','repeat','scope','weekdays'].includes(event.target.name)) {
        if (event.target.name === 'weekdays') eventForm.dataset.weekdaysEdited = 'true';
        if (event.target.name === 'date' && P.isDate(event.target.value) && eventForm.dataset.recurring !== 'true' && eventForm.dataset.weekdaysEdited !== 'true') {
          eventForm.querySelectorAll('[name="weekdays"]').forEach(input=>{input.checked=Number(input.value)===dayIndex(event.target.value);});
        }
        syncEventRepeat(eventForm);
      }
      if (eventForm && ['date','repeat','scope','weekdays','conflict'].includes(event.target.name)) syncEventReplacement(eventForm);
      if(event.target.id==='planner-backup-file') {
        const file=event.target.files[0];if(!file)return;if(file.size>15_000_000)throw new Error('Choose a backup smaller than 15 MB.');
        const generation=++importGeneration;const raw=await file.text();if(!mounted||generation!==importGeneration||!dialog.open)return;
        let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('This file is not valid JSON. Your current plan has not changed.');}
        const restored=importPlannerBackup(JSON.stringify(parsed.planner||parsed));
        pending={restore:restored,original:state};
        show('Review your backup.',`<p>${restored.tasks.length} tasks · ${restored.events.length} saved commitments and work-session records</p><p>Time zone: ${esc(restored.timeZone)}<br>Routine starts: ${dateLabel(restored.startDate)}</p><p>This replaces the current dated planner. Your original weekly questionnaire remains unchanged.</p><div class="dialog-actions">${action('close','Cancel')}${action('restore-apply','Restore this planner','','btn btn-primary')}</div>`);return;
      }
      if(event.target.id!=='calendar-file') return;
      const file=event.target.files[0]; if(!file)return;
      if(file.size>5*1024*1024)throw new Error('Choose a calendar smaller than 5 MB.');
      const form=dialog.querySelector('#planner-export-form'),data=new FormData(form),from=data.get('from'),through=data.get('through');
      const generation=++importGeneration;const original=state;const text=await file.text();if(!mounted||generation!==importGeneration||!dialog.open||state!==original)return;
      const result=parseCalendar(text,{timeZone:state.timeZone,startDate:from,endDate:through,existingEvents:state.events});
      pending={import:result,original:state};
      show('Review your calendar import.',`<p>${result.events.length} dated event blocks · ${result.duplicateCount} duplicates skipped · ${result.skipped} unsupported items skipped</p>${result.warnings.length?`<div class="notice"><strong>Import notes</strong><ul>${result.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}<div class="import-preview">${result.events.slice(0,200).map(e=>`<p><strong>${esc(e.title)}</strong><br>${dateLabel(e.date,true)} · ${times(e)}</p>`).join('')}${result.events.length>200?`<p>And ${result.events.length-200} more event blocks.</p>`:''}</div><p class="dialog-help">Imported events become fixed commitments. Any overlaps stay visible. Flexible tasks can be replanned afterward.</p><div class="dialog-actions">${action('close','Cancel')}${action('import-apply',`Add ${result.events.length} event blocks`,result.events.length?'':'disabled','btn btn-primary')}</div>`,true);
    } catch(error) {report(error);}
  }
  function onClick(event) {
    const button=event.target.closest('[data-plan]');if(!button||button.disabled)return;
    const {plan,id}=button.dataset;
    event.preventDefault();
    try {
      if(plan==='close')return close();
      if(plan==='backup')return download(JSON.stringify({planner:state,originalRoutine:legacy,savedPlanner:!state?localStorage.getItem('betterday.planner.v2'):undefined},null,2),'betterday-backup.json','application/json');
      if(plan==='restore')return restoreForm();
      if(plan==='restore-apply') {
        if(!pending?.restore||pending.original!==state)throw new Error('Choose the backup again to refresh the preview.');
        const restored=clone(pending.restore);restored.undo=state?{...clone(state),undo:null}:null;restored.revision=(state?.revision||0)+1;
        selectedDate=P.todayInZone(restored.timeZone);return commit(restored,'Saved planner restored.');
      }
      if(!state)return;
      if(plan==='task-new'||plan==='task-edit')return taskForm(id);
      if(plan==='event-new'||plan==='event-edit')return eventForm(id,button.dataset.date||selectedDate);
      if(plan==='commitment-time-add') {
        const form=button.closest('form'),rows=form.querySelector('[data-commitment-rows]');
        const original=commitmentSlots(form)[0];
        rows.insertAdjacentHTML('beforeend',commitmentTimeRow({id:`new-${++nextCommitmentRow}`,days:[],start:'',end:'',until:original?.until||null},rows.children.length));
        form.dataset.weekdaysEdited='true'; syncEventRepeat(form);syncEventReplacement(form);
        rows.lastElementChild.querySelector('[name="weekdays"]').focus();return;
      }
      if(plan==='commitment-time-remove') {
        const form=button.closest('form'),row=button.closest('[data-commitment-time]');
        if(form.querySelectorAll('[data-commitment-time]').length===1)return;
        row.remove();form.dataset.weekdaysEdited='true';syncEventRepeat(form);syncEventReplacement(form);
        form.querySelector('[data-plan="commitment-time-add"]').focus();return;
      }
      if(plan==='replan')return review();
      if(plan==='apply') {
        if(!pending?.preview)throw new Error('Create a new preview first.');
        if(state!==pending.original)throw new Error('Your plan changed. Close this preview and generate a new one.');
        if(pending.date===P.todayInZone(state.timeZone)&&Date.now()-pending.createdAt>60000) {const p=pending;review(p.candidate,{date:p.date,commitment:p.commitment,intro:'Time has moved on. Review this refreshed plan before applying.'});return;}
        selectedDate=pending.date;return commit(P.applyReplan(pending.candidate,pending.preview,{undoState:pending.original}),'Your updated plan is ready.');
      }
      if(plan==='undo')return commit(P.undoLastChange(state),'Previous state restored.');
      if(plan==='previous'||plan==='next'){selectedDate=P.addDays(selectedDate,plan==='previous'?-1:1);render();return;}
      if(plan==='today'){selectedDate=P.todayInZone(state.timeZone);render();return;}
      if(plan==='pick-date'){selectedDate=button.dataset.date;view='day';render();return;}
      if(plan==='view'){view=button.dataset.view;render();return;}
      if(plan==='tab'){taskTab=button.dataset.tab;render();return;}
      if(plan==='sleep')return sleepForm();
      if(plan==='awake')return awakeForm();
      if(plan==='routine')return onRoutine?.();
      if(plan==='exchange')return exchangeForm();
      if(plan==='done')return commit(P.completeTask(state,id,{date:selectedDate,nowMinutes:dateNow()}),'Task completed. Future time is free again.');
      if(plan==='rank') {
        const tasks=P.tasksForDate(state,selectedDate).filter(t=>t.status==='active');const index=tasks.findIndex(t=>t.id===id),target=index+Number(button.dataset.direction);
        if(target<0||target>=tasks.length)return;
        const next=clone(state),ordered=[...next.tasks].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
        const first=ordered.findIndex(t=>t.id===tasks[index].id),second=ordered.findIndex(t=>t.id===tasks[target].id);
        [ordered[first],ordered[second]]=[ordered[second],ordered[first]];ordered.forEach((t,i)=>{t.priority=i+1;});
        next.undo={...clone(state),undo:null};next.revision++;return commit(next,'Priority updated. Preview your plan to use the new order.');
      }
      if(plan==='progress'||plan==='defer') {
        const task=P.tasksForDate(state,selectedDate,{includeCompleted:true}).find(t=>t.id===id);
        if(!task)throw new Error('Choose a task available on this date.');
        return show(plan==='progress'?'Every little bit counts.':'Give this task some space.',`<form id="planner-${plan}-form" data-id="${esc(id)}"><p>${esc(task.title)}</p>${plan==='progress'?field('Minutes still needed','remaining',task.remaining,'number','min="0" max="525600" required'):field('Available again on','until',P.addDays(selectedDate,1),'date',`min="${P.addDays(selectedDate,1)}" required`)}<p class="dialog-help">${plan==='progress'?'Enter the work still remaining. Zero marks it complete. Preview your plan afterward to resize work sessions.':'Future sessions before this date will be removed. You can Undo this change.'}</p><div class="dialog-actions">${action('close','Cancel')}<button type="submit" class="btn btn-primary">Save change</button></div></form>`);
      }
      if(plan==='event-delete') {
        const date=button.dataset.date;const e=P.getEventsForDate(state,date).find(x=>x.id===id);const scope=dialog.querySelector('[name="scope"]')?.value||'this';
        const grouped=scope==='all' && e.kind==='fixed' && getCommitmentDetails(state,id,date);
        return show('Remove this event?',`<p>${esc(e.title)} · ${dateLabel(date)}</p><p>${grouped?'This removes all weekly times for this commitment. Separately edited dates stay on your calendar.':scope==='all'?'This removes the whole recurring series.':'This removes only this dated occurrence.'} Undo will be available.</p><div class="dialog-actions">${action('close','Keep event')}${action('delete-confirm','Remove event',`data-id="${esc(id)}" data-date="${date}" data-scope="${scope}" data-grouped="${Boolean(grouped)}"`,'btn btn-danger')}</div>`);
      }
      if(plan==='delete-confirm')return commit(button.dataset.grouped==='true'?deleteCommitmentGroup(state,id,button.dataset.date):P.deleteEvent(state,id,{date:button.dataset.date,scope:button.dataset.scope}),'Event removed.');
      if(plan==='import-apply') {
        if(!pending?.import||state!==pending.original)throw new Error('Choose your calendar file again to refresh the preview.');
        const next=clone(state);next.events=mergeCalendarEvents(state.events,pending.import.events).events;
        next.undo={...clone(state),undo:null};next.revision++;P.assertPlanner(next);return commit(next,'Calendar events imported. Preview your plan to fit tasks around them.');
      }
    }catch(error){report(error);}
  }
  function onSubmit(event) {
    const form=event.target;if(!form.id.startsWith('planner-'))return;
    event.preventDefault();if(!form.reportValidity())return;
    const data=new FormData(form),get=name=>data.get(name),id=form.dataset.id;
    try {
      if(form.id==='planner-setup-form') {
        const next=P.migrateLegacy(legacy,{startDate:get('startDate'),timeZone:get('timeZone').trim()});
        if(!saveMigratedPlanner(legacy,next))throw new Error('This browser could not save the backup and new planner. Your original routine remains unchanged.');
        state=next;selectedDate=P.todayInZone(next.timeZone);onChange(state);render();return;
      }
      if(form.id==='planner-task-form') {
        const original=state.tasks.find(t=>t.id===id),repeat=get('repeat');
        const next=P.editTask(state,{...original,id:id||undefined,title:get('title').trim(),remaining:Number(get('remaining')),duration:original?.duration||Number(get('remaining')),priority:Number(get('priority')),deadline:get('deadline')||null,split:data.has('split'),minSession:Number(get('minSession')),recurrence:repeat==='none'?null:{frequency:repeat,startDate:original?.recurrence?.startDate||selectedDate,days:repeat==='weekly'&&original?.recurrence?.frequency==='weekly'?original.recurrence.days:[dayIndex(selectedDate)],until:original?.recurrence?.until||null}},{date:selectedDate,nowMinutes:dateNow()});
        return commit(next,'Task saved. Preview your plan when you’re ready.');
      }
      if(form.id==='planner-event-form') {
        const existing=id?P.getEventsForDate(state,form.dataset.date).find(e=>e.id===id):null,scope=get('scope')||'this',mode=get('conflict');
        const onlyThisDate=Boolean(existing?.recurrence && scope==='this');
        const repeat=onlyThisDate?'none':form.elements.repeat.value;
        const slots=commitmentSlots(form),days=slots[0].days;
        if(repeat==='weekly' && slots.some(slot=>!slot.days.length)) throw new Error('Choose at least one day for each commitment time.');
        const date=eventFormDate(form);
        if(!date) throw new Error('No selected weekday remains before this commitment ends. Choose an earlier date.');
        if(mode==='move'&&date<P.todayInZone(state.timeZone))throw new Error('Past commitments can be edited using a conflict check or an intentional overlap.');
        let candidate=state;
        if(mode==='replace') {if(!get('replaceId'))throw new Error('Choose the event this commitment replaces.');candidate=P.deleteEvent(candidate,get('replaceId'),{date,scope:'this'});}
        if(weeklyCommitment(form)) {
          const values={id:id||undefined,sourceDate:form.dataset.date,title:get('title').trim(),date,slots};
          candidate=saveWeeklyCommitment(candidate,values,{nowMinutes:dateNow(date),conflict:mode==='reject'?'reject':mode==='move'?'move':'allow'});
          if(mode==='move')return review(candidate,{date,commitment:values,intro:'Review the commitment and how flexible tasks fit around it. Changes are saved only when you apply.'});
          return reviewEventOnly(candidate,values,mode,scope);
        }
        const values={...existing,id:id||undefined,title:get('title').trim(),date,start:onlyThisDate?get('occurrenceStart'):slots[0].start,end:onlyThisDate?get('occurrenceEnd'):slots[0].end,kind:existing?.kind||'fixed',taskId:existing?.taskId||null,locked:existing?.kind==='session'?data.has('locked'):true,recurrence:repeat==='none'?null:{frequency:repeat,...(repeat==='weekly'?{days}:{}),until:existing?.recurrence?.until||null},excludedDates:existing?.excludedDates||[]};
        if(mode==='move') {
          const conflicts=P.getEventsForDate(candidate,date).filter(e=>e.id!==id&&e.masterId!==existing?.masterId&&toMinutes(values.start)<toMinutes(e.end)&&toMinutes(values.end)>toMinutes(e.start));
          if(conflicts.some(e=>e.kind==='fixed'||e.locked||toMinutes(e.start)<dateNow(date)))throw new Error('This overlaps a fixed or already-started event. Choose another time, explicitly replace it, or keep both.');
        }
        candidate=P.saveEvent(candidate,values,{scope,date:form.dataset.date,nowMinutes:dateNow(date),conflict:mode==='reject'?'reject':mode==='move'?'move':'allow'});
        if(mode==='move')return review(candidate,{date,intro:`Add or update “${values.title}” (${times(values)}). ${recurrenceSummary(values)} Review how flexible tasks fit around it. Changes are saved only when you apply.`});
        return reviewEventOnly(candidate,values,mode,scope);
      }
      if(form.id==='planner-sleep-form') {
        let next=P.updateSleep(state,{wake:get('wake'),wakeLatest:get('wakeLatest'),bed:get('bed'),bedLatest:get('bedLatest'),minSleep:Math.round(Number(get('minSleep'))*60)});
        if(data.has('clearOverrides'))next.sleepOverrides={};return commit(next,'Sleep preferences saved. Preview your plan to use them.');
      }
      if(form.id==='planner-awake-form') {
        if(selectedDate!==P.todayInZone(state.timeZone)||toMinutes(get('wake'))>P.nowMinutesInZone(state.timeZone))throw new Error('Choose a wake-up time that has already happened today.');
        return review(P.setWakeTime(state,selectedDate,get('wake')),{intro:`Record your wake-up at ${formatTime(get('wake'))} and review the rest of today.`});
      }
      if(form.id==='planner-progress-form')return commit(Number(get('remaining'))===0?P.completeTask(state,id,{date:selectedDate,nowMinutes:dateNow()}):P.updateTaskRemaining(state,id,Number(get('remaining')),{date:selectedDate}),'Progress saved.');
      if(form.id==='planner-defer-form')return commit(P.deferTask(state,id,get('until'),{date:selectedDate,nowMinutes:dateNow()}),'Task deferred.');
      if(form.id==='planner-export-form')return download(exportCalendar(snapshotEvents(get('from'),get('through')),{timeZone:state.timeZone,startDate:get('from'),endDate:get('through'),calendarName:'BetterDay'}),'betterday-calendar.ics','text/calendar;charset=utf-8');
    }catch(error){report(error);}
  }
  function reviewEventOnly(candidate,values,mode,scope) {
    pending={eventCandidate:candidate,original:state,date:values.date};
    const noun=values.kind==='session'?'work session':'commitment';
    show(`Review this ${noun}.`,`<p><strong>${esc(values.title)}</strong><br>${dateLabel(values.date)}${values.slots?'':` · ${times(values)}`}</p>${values.slots?commitmentSummary(values.slots):''}${values.recurrence?`<p>${esc(recurrenceSummary(values))}</p>`:''}<p>${values.slots?'All weekly times will be saved together. ':scope==='all'?'Applies to the whole series. ':''}${mode==='allow'?'Overlapping events will be kept and visibly marked.':mode==='replace'?'The selected occurrence will be replaced.':'Other events stay unchanged.'}</p><div class="dialog-actions">${action('close','Cancel')}${action('save-appointment',`Save ${noun}`,'','btn btn-primary')}</div>`);
  }
  function onSaveAppointment(event) {
    if(!event.target.closest('[data-plan="save-appointment"]'))return;
    try{if(!pending?.eventCandidate||state!==pending.original)throw new Error('Your plan changed. Review the commitment again.');const next=pending.eventCandidate;selectedDate=pending.date;next.undo={...clone(state),undo:null};commit(next,'Changes saved.');}catch(error){report(error);}
  }
  function onDialogClose(){pending=null;importGeneration++;dialog.classList.remove('planner-dialog-wide');if(dialogFocus?.isConnected)dialogFocus.focus();else {const heading=container.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}}
  function onStorage(event){if(event.key!==null&&event.key!=='betterday.planner.v2')return;const fresh=loadPlanner();state=fresh.state;loaded.error=fresh.error;close();render();onChange(state);onNotice(fresh.error||'Your planner changed in another tab. This view now shows the latest saved plan.');}
  container.addEventListener('click',onClick);dialog.addEventListener('click',onClick);dialog.addEventListener('click',onSaveAppointment);
  container.addEventListener('change',onInput);dialog.addEventListener('change',onInput);
  container.addEventListener('submit',onSubmit);dialog.addEventListener('submit',onSubmit);dialog.addEventListener('close',onDialogClose);
  window.addEventListener('storage',onStorage);
  render();
  return ()=>{mounted=false;importGeneration++;window.removeEventListener('storage',onStorage);container.removeEventListener('click',onClick);dialog.removeEventListener('click',onClick);dialog.removeEventListener('click',onSaveAppointment);container.removeEventListener('change',onInput);dialog.removeEventListener('change',onInput);container.removeEventListener('submit',onSubmit);dialog.removeEventListener('submit',onSubmit);dialog.removeEventListener('close',onDialogClose);};
}
