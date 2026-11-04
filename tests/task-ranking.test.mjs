import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPlanner,saveTask,tasksForDate,reorderTask,undoLastChange} from '../js/planner.js';
const date='2026-11-04';
function fixture(){let s=emptyPlanner({startDate:date,timeZone:'UTC'});for(const id of ['a','hidden','b','c'])s=saveTask(s,{id,title:id,remaining:30,duration:30,priority:1,...(id==='hidden'?{availableFrom:'2027-01-01'}:{}),...(id==='c'?{deadline:date}:{})});return s;}
test('drag ranking moves across multiple rows, respects ties, preserves hidden tasks and supports Undo',()=>{
 const s=fixture(),before=structuredClone(s),ids=x=>tasksForDate(x,date).map(t=>t.id);
 assert.deepEqual(ids(s),['c','a','b']);
 const next=reorderTask(s,date,'c',2);
 assert.deepEqual(ids(next),['a','b','c']);assert.deepEqual(s,before);
 assert.deepEqual(next.events,s.events);
 assert.equal(next.tasks.find(t=>t.id==='hidden').availableFrom,'2027-01-01');
 assert.deepEqual(ids(undoLastChange(next)),ids(s));
 assert.deepEqual(ids(reorderTask(next,date,'c',0)),['c','a','b']);
});
test('ranking rejects unavailable tasks and invalid positions, and no-op does not replace Undo',()=>{
 const s=fixture();assert.equal(reorderTask(s,date,'c',0),s);
 for(const [id,pos] of [['hidden',0],['missing',0],['a',-1],['a',3]])assert.throws(()=>reorderTask(s,date,id,pos));
});
