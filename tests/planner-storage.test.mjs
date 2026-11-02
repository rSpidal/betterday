import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlanner, saveTask } from '../js/planner.js';
import { loadPlanner, savePlanner, saveMigratedPlanner, exportPlannerBackup, importPlannerBackup, PLANNER_STORAGE_KEY, PLANNER_BACKUP_KEY, LEGACY_BACKUP_KEY, PLANNER_RECOVERY_KEY } from '../js/planner-storage.js';
const base=()=>emptyPlanner({startDate:'2026-11-02',timeZone:'America/New_York'});
function storage() { const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))}; }

test('planner persists and migration keeps exact original v1 plus independent backup',()=>{
 const store=storage(), state=base(), legacy={version:1,schedule:{events:[]}};
 const raw=JSON.stringify(legacy);store.setItem('betterday.v1',raw);
 assert.equal(saveMigratedPlanner(legacy,state,store),true);
 assert.equal(store.getItem('betterday.v1'),raw);assert.equal(store.getItem(LEGACY_BACKUP_KEY),raw);
 assert.deepEqual(loadPlanner(store),{state,error:''});
});
test('a previous valid snapshot is available if the latest copy becomes unreadable',()=>{
 const store=storage(),state=base();savePlanner(state,store);
 const next=saveTask(state,{title:'Write essay'});savePlanner(next,store);
 assert.equal(store.getItem(PLANNER_BACKUP_KEY),JSON.stringify(state));
 store.setItem(PLANNER_STORAGE_KEY,'{broken');const result=loadPlanner(store);
 assert.deepEqual(result.state,state);assert.match(result.error,/previous saved version/);
 assert.equal(store.getItem(PLANNER_STORAGE_KEY),'{broken');
 assert.equal(savePlanner(state,store),true);assert.equal(store.getItem(PLANNER_RECOVERY_KEY),'{broken');
});
test('corrupt state and backup are preserved and never silently replaced on read',()=>{
 const store=storage();store.setItem(PLANNER_STORAGE_KEY,'{broken');store.setItem(PLANNER_BACKUP_KEY,'also broken');
 const result=loadPlanner(store);assert.equal(result.state,null);assert.ok(result.error);
 assert.equal(store.getItem(PLANNER_STORAGE_KEY),'{broken');assert.equal(store.getItem(PLANNER_BACKUP_KEY),'also broken');
});
test('blocked storage reports failure without claiming durable saving',()=>{
 const store={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
 assert.ok(loadPlanner(store).error);assert.equal(savePlanner(base(),store),false);assert.equal(saveMigratedPlanner({},base(),store),false);
});
test('backup import validates nested data before returning and round-trips valid plans',()=>{
 const state=saveTask(base(),{title:'Practice'});assert.deepEqual(importPlannerBackup(exportPlannerBackup(state)),state);
 const invalid=structuredClone(state);invalid.tasks[0].remaining=-1;
 assert.throws(()=>importPlannerBackup(JSON.stringify(invalid)),/not a valid/);
 assert.throws(()=>importPlannerBackup('{broken'),/not a valid/);
});

function transactionalStore() {
 const result=storage();result.removeItem=key=>result.values.delete(key);return result;
}
function legacyState(label) {return {version:1,answers:{label},schedule:{events:[]},draft:{label:'unfinished'},draftStep:2};}

test('routine replacement saves matching dated and legacy states with recoverable previous planner', async()=>{
 const {saveRoutineReplacement,ROUTINE_REPLACEMENT_JOURNAL_KEY}=await import('../js/planner-storage.js');
 const store=transactionalStore(),old=base(),next=saveTask(old,{title:'New routine task'});
 store.setItem('betterday.v1',JSON.stringify(legacyState('old')));savePlanner(old,store);
 const result=saveRoutineReplacement(legacyState('new'),next,store);
 assert.deepEqual(result,{saved:true,error:''});assert.deepEqual(loadPlanner(store).state,next);
 assert.equal(JSON.parse(store.getItem('betterday.v1')).answers.label,'new');assert.equal(store.getItem(PLANNER_BACKUP_KEY),JSON.stringify(old));
 assert.equal(store.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY),null);
});

test('routine replacement rolls back both states and backup/recovery keys when legacy save fails', async()=>{
 const {saveRoutineReplacement}=await import('../js/planner-storage.js');
 const store=transactionalStore(),old=base(),next=saveTask(old,{title:'New'}),oldLegacy=JSON.stringify(legacyState('old'));
 store.setItem('betterday.v1',oldLegacy);savePlanner(old,store);store.setItem(PLANNER_BACKUP_KEY,'prior backup');store.setItem(PLANNER_RECOVERY_KEY,'prior recovery');
 const original=new Map(store.values),write=store.setItem;let failed=false;
 store.setItem=(key,value)=>{if(key==='betterday.v1'&&value!==oldLegacy&&!failed){failed=true;throw Error('quota');}write(key,value);};
 const result=saveRoutineReplacement(legacyState('new'),next,store);
 assert.equal(result.saved,false);assert.match(result.error,/restored/);assert.deepEqual(store.values,original);
});

test('interrupted rollback retains a durable journal and load recovers before reading either state', async()=>{
 const {saveRoutineReplacement,ROUTINE_REPLACEMENT_JOURNAL_KEY}=await import('../js/planner-storage.js');
 const store=transactionalStore(),old=base(),next=saveTask(old,{title:'New'}),oldLegacy=JSON.stringify(legacyState('old'));
 store.setItem('betterday.v1',oldLegacy);savePlanner(old,store);
 const write=store.setItem;let blocked=false;
 store.setItem=(key,value)=>{if(key==='betterday.v1')blocked=true;if(blocked)throw Error('storage blocked');write(key,value);};
 const result=saveRoutineReplacement(legacyState('new'),next,store);
 assert.equal(result.saved,false);assert.match(result.error,/recovery is incomplete/);assert.ok(store.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY));
 store.setItem=write;
 const loaded=loadPlanner(store);assert.deepEqual(loaded.state,old);assert.match(loaded.error,/rolled back/);
 assert.equal(store.getItem('betterday.v1'),oldLegacy);assert.equal(store.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY),null);
});

test('committed journal cleanup failure never rolls back a successful replacement', async()=>{
 const {saveRoutineReplacement,ROUTINE_REPLACEMENT_JOURNAL_KEY}=await import('../js/planner-storage.js');
 const store=transactionalStore(),old=base(),next=saveTask(old,{title:'New'});
 store.setItem('betterday.v1',JSON.stringify(legacyState('old')));savePlanner(old,store);
 const remove=store.removeItem;store.removeItem=()=>{throw Error('blocked cleanup');};
 assert.equal(saveRoutineReplacement(legacyState('new'),next,store).saved,true);
 assert.equal(JSON.parse(store.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY)).phase,'committed');
 assert.deepEqual(loadPlanner(store).state,next);
 store.removeItem=remove;assert.deepEqual(loadPlanner(store).state,next);assert.equal(store.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY),null);
});

test('backup-write failure leaves an existing corrupt-data recovery copy untouched',()=>{
 const store=transactionalStore(),old=base(),next=saveTask(old,{title:'New'});
 savePlanner(old,store);store.setItem(PLANNER_RECOVERY_KEY,'precious unreadable data');
 const write=store.setItem;store.setItem=(key,value)=>{if(key===PLANNER_BACKUP_KEY)throw Error('quota');write(key,value);};
 assert.equal(savePlanner(next,store),false);assert.equal(store.getItem(PLANNER_RECOVERY_KEY),'precious unreadable data');
 assert.deepEqual(loadPlanner(store).state,old);
});
