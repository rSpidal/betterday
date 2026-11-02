import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlanner, saveTask, saveEvent, getEventsForDate, tasksForDate, previewReplan, applyReplan, undoLastChange, completeTask, updateTaskRemaining, deferTask, setWakeTime, updateSleep, migrateLegacy, replaceRoutine, assertPlanner, deleteEvent, isDate, addDays, weekStart, todayInZone, nowMinutesInZone } from '../js/planner.js';
import { generateSchedule } from '../js/scheduler.js';

const DATE = '2026-11-02';
const base = () => emptyPlanner({ startDate: DATE, timeZone: 'America/New_York' });
const task = (state, values = {}) => saveTask(state, { id: 't1', title: 'Practice', remaining: 60, duration: 60, ...values });
const event = (state, values = {}, options = {}) => saveEvent(state, { id: 'e1', title: 'Class', date: DATE, start: '10:00', end: '11:00', ...values }, options);
const replan = (state, options = {}) => previewReplan(state, { date: DATE, nowMinutes: 540, ...options });
const minutes = clock => Number(clock.slice(0,2))*60 + Number(clock.slice(3));
const total = events => events.reduce((sum, event) => sum + minutes(event.end) - minutes(event.start), 0);

function legacy() {
  const answers = { sleep: { wake: '07:00', bed: '23:00', overrides: { 5: { wake: '09:00', bed: '23:30' } } }, commitments: [{ id:'class',title:'Class',days:[0,2],start:'09:00',end:'12:00' }], activities: [{id:'practice',title:'Practice',category:'hobby',duration:60,frequency:3,preference:'afternoon',days:[0,1,2,3,4,5,6]}], challenge:'' };
  return { version:1,answers,schedule:generateSchedule(answers),draft:null,draftStep:0 };
}

test('date arithmetic and zone time work over month, leap day, and DST boundaries', () => {
  assert.equal(isDate('2026-02-30'), false); assert.equal(isDate('2024-02-29'), true);
  assert.equal(addDays('2024-02-28', 1),'2024-02-29'); assert.equal(addDays('2026-12-31',1),'2027-01-01');
  assert.equal(weekStart('2026-11-01'),'2026-10-26');
  assert.equal(todayInZone('America/New_York',new Date('2026-11-02T02:00:00Z')),'2026-11-01');
  assert.equal(nowMinutesInZone('America/New_York',new Date('2026-11-01T05:30:00Z')),90);
  assert.equal(nowMinutesInZone('America/New_York',new Date('2026-11-01T06:30:00Z')),90);
});

test('weekly legacy migration preserves every event, independent sleep overrides, and original data', () => {
  const source=legacy(), original=structuredClone(source);
  const state=migrateLegacy(source,{startDate:DATE,timeZone:'America/New_York'});
  assert.equal(state.events.length,source.schedule.events.length);
  assert.equal(state.tasks.length,source.schedule.events.filter(e=>e.type==='activity').length);
  assert.deepEqual(source,original); assertPlanner(state);
  assert.deepEqual(getEventsForDate(state,DATE).map(e=>[e.title,e.start,e.end]),getEventsForDate(state,addDays(DATE,7)).map(e=>[e.title,e.start,e.end]));
  state.sleepOverrides[5].wake='10:00'; assert.equal(source.answers.sleep.overrides[5].wake,'09:00');
});

test('unplaced legacy intentions survive migration as unscheduled tasks', () => {
  const source=legacy(); source.schedule.events=source.schedule.events.filter(e=>e.type==='commitment');
  const state=migrateLegacy(source,{startDate:DATE,timeZone:'America/New_York'});
  assert.equal(state.tasks.length,3); assert.equal(state.events.length,2);
});

test('weekly and daily occurrences respect start dates, end dates, and exclusions', () => {
  let state=event(base(),{recurrence:{frequency:'weekly',days:[0,2],until:'2026-11-11'}});
  assert.equal(getEventsForDate(state,'2026-11-01').length,0);
  assert.equal(getEventsForDate(state,'2026-11-04').length,1);
  assert.equal(getEventsForDate(state,'2026-11-12').length,0);
  state=deleteEvent(state,'e1@2026-11-04',{date:'2026-11-04'});
  assert.equal(getEventsForDate(state,'2026-11-04').length,0); assert.equal(getEventsForDate(state,'2026-11-09').length,1);
});

test('editing one occurrence leaves its recurring series intact; all scope edits the series', () => {
  let state=event(base(),{recurrence:'weekly'});
  state=saveEvent(state,{...getEventsForDate(state,DATE)[0],title:'Changed just today',start:'11:00',end:'12:00'},{scope:'this',date:DATE});
  assert.equal(getEventsForDate(state,DATE)[0].title,'Changed just today');
  assert.equal(getEventsForDate(state,addDays(DATE,7))[0].title,'Class');
  state=saveEvent(state,{...getEventsForDate(state,addDays(DATE,7))[0],title:'Weekly class'},{scope:'all',date:addDays(DATE,7)});
  assert.equal(getEventsForDate(state,addDays(DATE,14))[0].title,'Weekly class');
});

test('manual overlap requires explicit allowance and allows adjacent events', () => {
  let state=event(base());
  assert.throws(()=>event(state,{id:'e2',start:'10:30',end:'11:30'}),/overlaps Class/);
  assert.equal(event(state,{id:'e2',start:'11:00',end:'12:00'}).events.length,2);
  state=event(state,{id:'e2',start:'10:30',end:'11:30'},{conflict:'allow'});
  assert.equal(state.events.length,2);
});

test('recurring event overlap is caught on later dates instead of only its first day', () => {
  let state=event(base(),{date:'2026-12-07'});
  assert.throws(()=>event(state,{id:'new',recurrence:'weekly',start:'10:30',end:'11:30'}),/2026-12-07/);
});

test('preview is pure, protects commitments, respects transition buffers and records explanations', () => {
  let state=task(event(base())); const original=structuredClone(state);
  const preview=replan(state);
  assert.deepEqual(state,original); assert.equal(preview.events[0].start,'11:10');
  assert.equal(preview.preserved[0].title,'Class'); assert.equal(preview.changes.length,1);
  assert.match(preview.changes[0].reason,/priority/);
});

test('priority determines which work fits and unscheduled work is never silently shortened', () => {
  let state=updateSleep(base(),{wake:'07:00',wakeLatest:'07:00',bed:'11:00',bedLatest:'11:00',minSleep:0});
  state=task(state,{remaining:120,duration:120,priority:1});
  state=task(state,{id:'low',title:'Walk',remaining:60,duration:60,priority:2});
  const preview=replan(state);
  assert.equal(preview.events.length,1); assert.equal(preview.events[0].taskId,'t1'); assert.equal(total(preview.events),120);
  assert.equal(preview.unplaced[0].taskId,'low'); assert.equal(preview.unplaced[0].minutes,60);
});

test('split work uses multiple useful gaps without exceeding remaining effort', () => {
  let state=task(event(base()),{remaining:100,duration:100,split:true,minSession:20});
  state=updateSleep(state,{bed:'12:00',bedLatest:'12:00',minSleep:0});
  const preview=replan(state);
  assert.equal(preview.events.length,2); assert.equal(total(preview.events),100);
  assert.equal(preview.events[0].start,'09:00'); assert.equal(preview.events[0].end,'09:50');
  assert.equal(preview.events[1].start,'11:10'); assert.equal(preview.events[1].end,'12:00');
});

test('in-progress and locked sessions stay anchored and reserve remaining effort', () => {
  let state=task(base(),{remaining:90,duration:90});
  state=event(state,{id:'ongoing',title:'Practice',start:'08:30',end:'09:30',kind:'session',taskId:'t1',locked:false});
  state=event(state,{id:'locked',title:'Practice',start:'11:00',end:'11:30',kind:'session',taskId:'t1',locked:true});
  const preview=replan(state);
  assert.equal(preview.preserved.length,2); assert.equal(total(preview.events),30);
  assert.equal(preview.events[0].start,'09:40');
});

test('past session time does not automatically count as completed work', () => {
  let state=task(base()); state=event(state,{kind:'session',taskId:'t1',locked:false,start:'07:00',end:'08:00'});
  const preview=replan(state); assert.equal(total(preview.events),60); assert.equal(tasksForDate(state,DATE)[0].remaining,60);
});

test('work reserved on another future date is not duplicated when replanning today', () => {
  let state=task(base()); state=event(state,{kind:'session',taskId:'t1',locked:false,date:addDays(DATE,1)});
  assert.equal(replan(state).events.length,0);
});

test('preview apply and undo restore full state and reject a stale preview', () => {
  const state=task(event(base())), preview=replan(state), next=applyReplan(state,preview);
  assert.equal(getEventsForDate(next,DATE).length,2);
  const undone=undoLastChange(next); const expected={...state,revision:undone.revision,undo:null}; assert.deepEqual(undone,expected);
  assert.throws(()=>applyReplan(task(state,{id:'another'}),preview),/changed since/);
});

test('an interruption candidate and replan can apply as one undoable transaction', () => {
  const original=applyReplan(task(base()),replan(task(base())));
  const candidate=event(original,{start:'09:00',end:'10:00'},{conflict:'allow'});
  const applied=applyReplan(candidate,replan(candidate),{undoState:original});
  assert.equal(applied.events.find(e=>e.kind==='session').start,'10:10');
  const undone=undoLastChange(applied); assert.deepEqual(undone.events,original.events);
});

test('replanning a recurring work session changes only that date and can be repeated safely', () => {
  let state=task(base(),{recurrence:{frequency:'weekly',days:[0],startDate:DATE}});
  state=event(state,{id:'weekly',kind:'session',taskId:'t1',locked:false,start:'08:00',end:'09:00',recurrence:'weekly'});
  state=applyReplan(state,replan(state,{nowMinutes:420}));
  assert.equal(getEventsForDate(state,DATE).length,1); assert.equal(getEventsForDate(state,addDays(DATE,7)).length,1);
  state=applyReplan(state,replan(state,{nowMinutes:420})); assert.equal(getEventsForDate(state,DATE).length,1);
});

test('task completion archives the task and removes future work but preserves history', () => {
  let state=task(base()); state=event(state,{id:'past',kind:'session',taskId:'t1',locked:false,start:'07:00',end:'08:00'});
  state=event(state,{id:'future',kind:'session',taskId:'t1',locked:false,date:addDays(DATE,1)});
  state=completeTask(state,'t1',{date:DATE,nowMinutes:540});
  assert.equal(state.tasks[0].status,'completed'); assert.equal(state.events.length,1); assert.equal(state.events[0].id,'past');
  assert.equal(tasksForDate(state,DATE).length,0); assert.equal(tasksForDate(state,DATE,{includeCompleted:true}).length,1);
});

test('recurring task completion and partial progress affect only selected date', () => {
  let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
  state=updateTaskRemaining(state,'t1',25,{date:DATE});
  assert.equal(tasksForDate(state,DATE)[0].remaining,25); assert.equal(tasksForDate(state,addDays(DATE,1))[0].remaining,60);
  state=completeTask(state,'t1',{date:DATE,nowMinutes:540});
  assert.equal(tasksForDate(state,DATE).length,0); assert.equal(tasksForDate(state,addDays(DATE,1)).length,1);
});

test('defer removes scheduled occurrences until the chosen date without losing task', () => {
  let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
  state=event(state,{kind:'session',taskId:'t1',locked:false,recurrence:'daily'});
  state=deferTask(state,'t1',addDays(DATE,2),{date:DATE,nowMinutes:540});
  assert.equal(getEventsForDate(state,DATE).length,0); assert.equal(getEventsForDate(state,addDays(DATE,1)).length,0);
  assert.equal(getEventsForDate(state,addDays(DATE,2)).length,1); assert.equal(tasksForDate(state,DATE)[0].eligible,false);
});

test('wake range uses latest wake while actual wake adjusts only that date', () => {
  let state=task(updateSleep(base(),{wake:'07:00',wakeLatest:'08:00',bed:'22:30',bedLatest:'23:00',minSleep:420}));
  assert.equal(replan(state,{nowMinutes:0}).events[0].start,'08:00');
  state=setWakeTime(state,DATE,'09:30'); assert.equal(replan(state,{nowMinutes:0}).events[0].start,'09:30');
  assert.equal(replan(state,{date:addDays(DATE,1),nowMinutes:0}).events[0].start,'08:00');
  assert.throws(()=>updateSleep(state,{bedLatest:'23:30',minSleep:480}),/minimum sleep/);
});

test('waking after the usual bedtime does not open a misleading overnight work window', () => {
  const state=setWakeTime(task(base()),DATE,'23:30');
  assert.equal(replan(state,{nowMinutes:1410}).events.length,0);
});

test('midnight end remains valid and protected events with explicit overlaps stay visible', () => {
  let state=event(base(),{start:'23:00',end:'00:00'}); assert.equal(state.events[0].end,'24:00');
  state=event(state,{id:'e2',start:'23:30',end:'24:00'},{conflict:'allow'});
  assert.match(replan(state).notes.join(' '),/overlaps/);
});

test('retaking routine preserves custom tasks/events and historical migrated entries', () => {
  let state=migrateLegacy(legacy(),{startDate:DATE,timeZone:'America/New_York'});
  state=task(state,{id:'custom'}); state=event(state,{id:'custom-event',date:'2026-12-01'});
  const next=replaceRoutine(state,legacy(),{startDate:'2026-11-09'});
  assert.ok(next.tasks.some(t=>t.id==='custom')); assert.ok(next.events.some(e=>e.id==='custom-event'));
  assert.equal(getEventsForDate(next,DATE).length,getEventsForDate(state,DATE).length);
  assert.equal(getEventsForDate(next,'2026-11-09').filter(e=>e.title==='Class').length,1);
  assertPlanner(next);
});

test('invalid nested data, dangling tasks, and duplicate IDs fail validation', () => {
  for (const mutate of [
    s=>s.sleep.wake='bad', s=>s.timeZone='Wrong/Zone', s=>s.startDate='2026-02-30',
    s=>s.tasks[0].remaining=-1, s=>s.tasks[0].progressByDate={'bad':10}, s=>s.tasks.push(structuredClone(s.tasks[0])),
    s=>s.events.push({id:'bad',title:'Broken',date:DATE,start:'09:00',end:'10:00',kind:'session',taskId:'missing',locked:false,recurrence:null,excludedDates:[]}),
    s=>s.undo={bad:true},
  ]) { const state=task(base()); mutate(state); assert.throws(()=>assertPlanner(state)); }
});

test('a new allocation gets a distinct identity from preserved in-progress work', () => {
  let state=task(base()); state=applyReplan(state,replan(state));
  const preview=replan(state,{nowMinutes:570});
  assert.equal(preview.preserved.length,1); assert.equal(total(preview.events),30);
  assert.notEqual(preview.events[0].id,preview.preserved[0].id);
  state=applyReplan(state,preview); assert.equal(getEventsForDate(state,DATE).length,2);
});

test('recurring collision checking looks beyond excluded first occurrences', () => {
  let state=event(base(),{recurrence:'weekly',excludedDates:[DATE,'2026-11-09','2026-11-16']});
  assert.throws(()=>event(state,{id:'new',recurrence:'weekly',start:'10:30',end:'11:30'}),/2026-11-23/);
});

test('new forms may explicitly pass an undefined ID without overriding generated identity', () => {
  assert.ok(saveTask(base(),{id:undefined,title:'New'}).tasks[0].id);
  assert.ok(event(base(),{id:undefined}).events[0].id);
});

test('move conflict mode permits flexible work but rejects recurring protected collisions', () => {
  let state=task(base());state=event(state,{kind:'session',taskId:'t1',locked:false});
  assert.equal(event(state,{id:'new'},{conflict:'move',nowMinutes:540}).events.length,2);
  assert.throws(()=>event(state,{id:'new'},{conflict:'move',nowMinutes:630}),/overlaps/);
  state=event(state,{id:'later',date:'2026-12-07',start:'12:00',end:'13:00'});
  assert.throws(()=>event(state,{id:'new',start:'12:00',end:'13:00',recurrence:'weekly'},{conflict:'move'}),/2026-12-07/);
});

test('completing in-progress work releases its future tail and preserves elapsed history', () => {
  let state=task(base());state=event(state,{kind:'session',taskId:'t1',locked:false,start:'09:00',end:'10:00',recurrence:'weekly'});
  state=completeTask(state,'t1',{date:DATE,nowMinutes:570});
  assert.equal(getEventsForDate(state,DATE)[0].end,'09:30');
  assert.equal(getEventsForDate(state,addDays(DATE,7)).length,0);
  state=task(state,{id:'new'});assert.equal(replan(state,{nowMinutes:570}).events[0].start,'09:40');
});

test('reducing remaining effort previews removal of excess future flexible allocations', () => {
  let state=task(base());state=event(state,{date:addDays(DATE,1),kind:'session',taskId:'t1',locked:false});
  state=updateTaskRemaining(state,'t1',30,{date:DATE});const preview=replan(state);
  assert.equal(preview.events.length,1);assert.equal(total(preview.events),30);
  assert.match(preview.changes[0].reason,/2026-11-03/);
  state=applyReplan(state,preview);assert.equal(getEventsForDate(state,addDays(DATE,1)).length,0);
});

test('replacing a routine retires unfinished intentions without fabricating completion', () => {
  const state=migrateLegacy(legacy(),{startDate:DATE,timeZone:'America/New_York'});
  const next=replaceRoutine(state,legacy(),{startDate:'2026-11-09'});
  assert.equal(next.tasks.filter(task=>task.status==='completed').length,0);
});

test('clock-change hours are kept out of automatic sessions and clearly explained', async () => {
  const {clockChangeWindows}=await import('../js/planner.js');
  assert.deepEqual(clockChangeWindows('2026-03-08','America/New_York'),[[120,180]]);
  assert.deepEqual(clockChangeWindows('2026-11-01','America/New_York'),[[60,120]]);
  assert.deepEqual(clockChangeWindows('2026-11-02','America/New_York'),[]);
  let state=task(base(),{remaining:120,duration:120});
  state=updateSleep(state,{wake:'00:00',wakeLatest:'00:00',bed:'06:00',bedLatest:'06:00',minSleep:0});
  const preview=replan(state,{date:'2026-03-08',nowMinutes:60});
  assert.equal(preview.events[0].start,'03:00');assert.match(preview.notes.join(' '),/clock changes/);
  assert.throws(()=>event(state,{date:'2026-03-08',start:'02:15',end:'03:15'}),/clock-change/);
});

test('move mode only replans the selected date and rejects silent future-series overlaps', () => {
  let state=task(base(),{recurrence:{frequency:'weekly',days:[0],startDate:DATE}});
  state=event(state,{kind:'session',taskId:'t1',locked:false,recurrence:'weekly'});
  assert.throws(()=>event(state,{id:'new',recurrence:'weekly'},{conflict:'move',date:DATE,nowMinutes:540}),/repeating change overlaps work on 2026-11-09/);
});

test('moving an event to a new date permits replanning on its destination date', () => {
 let state=task(base());state=event(state,{id:'work',date:addDays(DATE,1),kind:'session',taskId:'t1',locked:false});
 state=event(state,{id:'appointment',start:'12:00',end:'13:00'});
 const existing=getEventsForDate(state,DATE).find(e=>e.id==='appointment');
 const next=saveEvent(state,{...existing,date:addDays(DATE,1),start:'10:00',end:'11:00'},{scope:'this',date:DATE,conflict:'move',nowMinutes:0});
 assert.equal(next.events.find(e=>e.id==='appointment').date,addDays(DATE,1));
});

test('retaking questionnaire keeps currently edited series and their dated exceptions', async () => {
 const {routineCommitments}=await import('../js/planner.js');
 let state=migrateLegacy(legacy(),{startDate:DATE,timeZone:'America/New_York'});
 let monday=getEventsForDate(state,DATE).find(e=>e.kind==='fixed');
 state=saveEvent(state,{...monday,start:'10:00',end:'12:00'},{scope:'all',date:DATE,conflict:'allow'});
 const date='2026-11-09';monday=getEventsForDate(state,date).find(e=>e.kind==='fixed');
 state=saveEvent(state,{...monday,title:'Special class',start:'11:00',end:'12:00'},{scope:'this',date,conflict:'allow'});
 const kept=routineCommitments(state,{date:DATE});
 assert.ok(kept.some(c=>c.start==='10:00'&&c._plannerMasterIds.length));
 const original=legacy();original.answers.commitments=kept;original.schedule=generateSchedule(original.answers);
 const next=replaceRoutine(state,original,{startDate:date});
 assert.equal(getEventsForDate(next,date).filter(e=>e.kind==='fixed').length,1);
 assert.equal(getEventsForDate(next,date).find(e=>e.kind==='fixed').title,'Special class');
 assert.equal(getEventsForDate(next,'2026-11-16').find(e=>e.kind==='fixed').start,'10:00');
});

test('bedtime range can cross midnight while preserving minimum sleep', () => {
 const state=updateSleep(base(),{wake:'08:00',wakeLatest:'09:00',bed:'23:00',bedLatest:'01:00',minSleep:420});
 assert.equal(state.sleep.bedLatest,'01:00');
 assert.throws(()=>updateSleep(state,{minSleep:480}),/minimum sleep/);
 assert.throws(()=>updateSleep(state,{bed:'22:00',bedLatest:'15:00'}),/ranges/);
});

test('malformed completed dates and all-day flags fail persisted-data validation', () => {
 const state=task(base());state.tasks[0].status='completed';state.tasks[0].completedAt=123;
 assert.throws(()=>assertPlanner(state));
 const next=event(base());next.events[0].allDay='false';assert.throws(()=>assertPlanner(next));
});

test('ranges cannot wrap past waking or span across the entire available day', () => {
 assert.throws(()=>updateSleep(base(),{wake:'08:00',wakeLatest:'09:00',bed:'23:00',bedLatest:'11:00',minSleep:420}),/minimum sleep/);
 assert.throws(()=>updateSleep(base(),{wakeLatest:'23:00',bed:'22:00',bedLatest:'22:00',minSleep:0}),/latest wake-up/);
});

test('editTask changes selected recurring effort without changing later occurrence estimates', async () => {
 const {editTask}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
 state=updateTaskRemaining(state,'t1',40,{date:DATE});const before=structuredClone(state);
 const next=editTask(state,{...state.tasks[0],title:'Focused practice',remaining:25},{date:DATE,nowMinutes:540});
 assert.equal(tasksForDate(next,DATE)[0].remaining,25);assert.equal(tasksForDate(next,addDays(DATE,1))[0].remaining,60);
 assert.equal(next.revision,state.revision+1);assert.deepEqual(state,before);
 assert.deepEqual(undoLastChange(next).tasks,state.tasks);
});

test('recurring to one-off retires future flexible sessions while preserving history and locked work', async () => {
 const {editTask,completedTaskHistory}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
 state=event(state,{id:'daily-work',kind:'session',taskId:'t1',locked:false,recurrence:'daily'});
 state=completeTask(state,'t1',{date:DATE,nowMinutes:660});
 const date=addDays(DATE,1);
 state=event(state,{id:'locked',date:addDays(DATE,2),start:'12:00',end:'12:30',kind:'session',taskId:'t1',locked:true});
 const next=editTask(state,{...state.tasks[0],remaining:30,recurrence:null},{date,nowMinutes:540});
 assert.equal(next.tasks[0].recurrence,null);assert.equal(next.tasks[0].remaining,30);
 assert.equal(getEventsForDate(next,date).length,0);assert.equal(getEventsForDate(next,DATE).length,1);
 assert.deepEqual(getEventsForDate(next,addDays(DATE,2)).map(e=>e.id),['locked']);
 assert.deepEqual(completedTaskHistory(next),[{id:'t1',title:'Practice',date:DATE}]);
 assert.equal(previewReplan(next,{date,nowMinutes:540}).events.length,0,'remaining effort is already reserved in the locked later session');
});

test('one-off to recurring starts on selected date and removes obsolete flexible allocations', async () => {
 const {editTask}=await import('../js/planner.js');
 let state=task(base());state=event(state,{id:'future-work',date:addDays(DATE,3),kind:'session',taskId:'t1',locked:false});
 const date=addDays(DATE,1);
 const next=editTask(state,{...state.tasks[0],remaining:25,recurrence:'daily'},{date,nowMinutes:540});
 assert.equal(tasksForDate(next,DATE).length,0);assert.equal(tasksForDate(next,date)[0].remaining,25);
 assert.equal(tasksForDate(next,addDays(date,1))[0].remaining,60);assert.equal(next.events.length,0);
 assert.equal(next.tasks[0].history.length,1);assertPlanner(next);
});

test('daily to weekly clears obsolete repeats, retains current work, and uses the new weekday', async () => {
 const {editTask}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE},availableDays:[0]});
 state=event(state,{id:'daily-work',start:'09:00',end:'10:00',kind:'session',taskId:'t1',locked:false,recurrence:'daily'});
 const next=editTask(state,{...state.tasks[0],remaining:45,recurrence:{frequency:'weekly',days:[0]}},{date:DATE,nowMinutes:570});
 assert.equal(getEventsForDate(next,DATE).length,1);assert.equal(getEventsForDate(next,addDays(DATE,1)).length,0);
 assert.equal(tasksForDate(next,addDays(DATE,1)).length,0);assert.equal(tasksForDate(next,addDays(DATE,7))[0].remaining,60);
 assert.equal(previewReplan(next,{date:DATE,nowMinutes:570}).events.reduce((sum,e)=>sum+minutes(e.end)-minutes(e.start),0),15,'in-progress remainder is reserved exactly once');
});

test('weekly to daily removes migrated hidden weekday restriction', async () => {
 const {editTask}=await import('../js/planner.js');
 const state=task(base(),{recurrence:{frequency:'weekly',days:[0],startDate:DATE},availableDays:[0]});
 const next=editTask(state,{...state.tasks[0],remaining:60,recurrence:'daily'},{date:DATE,nowMinutes:540});
 assert.equal(tasksForDate(next,addDays(DATE,1))[0].eligible,true);
});

test('repeat change requires resolving a locked repeating work session first', async () => {
 const {editTask}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
 state=event(state,{kind:'session',taskId:'t1',locked:true,recurrence:'daily'});
 const original=structuredClone(state);
 assert.throws(()=>editTask(state,{...state.tasks[0],remaining:60,recurrence:null},{date:DATE,nowMinutes:540}),/locked repeating work session/);
 assert.deepEqual(state,original);
});

test('dated locked work outside a changed recurrence remains visible without creating extra work', async () => {
 const {editTask}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
 const date=addDays(DATE,1);
 state=event(state,{date,kind:'session',taskId:'t1',locked:true});
 const next=editTask(state,{...state.tasks[0],remaining:60,recurrence:{frequency:'weekly',days:[0]}},{date:DATE,nowMinutes:540});
 const row=tasksForDate(next,date)[0];assert.equal(row.eligible,false);assert.match(row.reason,/locked work session/);
 assert.equal(previewReplan(next,{date,nowMinutes:540}).events.length,0);
 assert.equal(getEventsForDate(next,date).length,1);
});

test('completed history survives multiple repeat changes without duplicates or fabricated completion', async () => {
 const {editTask,completedTaskHistory}=await import('../js/planner.js');
 let state=task(base(),{recurrence:{frequency:'daily',startDate:DATE}});
 state=completeTask(state,'t1',{date:DATE,nowMinutes:540});
 state=editTask(state,{...state.tasks[0],title:'New practice',remaining:30,recurrence:null},{date:addDays(DATE,1),nowMinutes:540});
 state=completeTask(state,'t1',{date:addDays(DATE,1),nowMinutes:540});
 state=editTask(state,{...state.tasks[0],remaining:60,recurrence:'daily'},{date:addDays(DATE,2),nowMinutes:540});
 assert.deepEqual(completedTaskHistory(state),[{id:'t1',title:'New practice',date:addDays(DATE,1)},{id:'t1',title:'Practice',date:DATE}]);
 assert.equal(tasksForDate(state,addDays(DATE,2))[0].status,'active');assertPlanner(state);
});
