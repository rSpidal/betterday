import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPlanner,saveTask,previewReplan,customizePreview,applyReplan,undoLastChange,taskWindows} from '../js/planner.js';
const date='2026-11-04';
function fixture(){let s=emptyPlanner({startDate:date,timeZone:'UTC'});for(const id of ['a','b','c','d'])s=saveTask(s,{id,title:id,remaining:30,duration:30,priority:1});return s;}
const preview=s=>previewReplan(s,{date,nowMinutes:600,bufferMinutes:90});
test('buffers protect both boundaries and can be overridden',()=>{const s=fixture();assert.deepEqual(taskWindows(s,date),[[510,1290]]);assert.deepEqual(taskWindows(s,date,0),[[420,1380]]);const p=previewReplan(s,{date,bufferMinutes:90});assert.equal(p.events[0].start,'08:30');});
test('current time and requested readiness both constrain placement',()=>{const p=previewReplan(fixture(),{date,nowMinutes:600,readyAt:645,bufferMinutes:90});assert.equal(p.events[0].start,'10:45');});
test('removing one block keeps three, preserves task effort, and supports Undo',()=>{const s=fixture(),p=preview(s);const next=applyReplan(s,customizePreview(s,p,{[p.events[3].id]:{remove:true}},600));assert.equal(next.events.length,3);assert.deepEqual(next.tasks,s.tasks);assert.deepEqual(undoLastChange(next).events,s.events);});
test('manual edits allow free times and reject overlap, past time, sleep buffer and excess duration',()=>{const s=fixture(),p=preview(s),id=p.events[0].id;assert.equal(customizePreview(s,p,{[id]:{start:'15:00',end:'15:30'}},600).events[0].start,'15:00');for(const [start,end] of [['09:00','09:30'],['10:45','11:15'],['22:00','22:30'],['15:00','16:00']])assert.throws(()=>customizePreview(s,p,{[id]:{start,end}},600));});
test('apply validation detects time advancing while preview is open',()=>{const s=fixture(),p=preview(s);assert.throws(()=>customizePreview(s,p,{},601),/after now/);});
test('overnight waking windows buffer actual sleep boundaries, not midnight',()=>{const s=fixture();s.sleep={...s.sleep,wake:'16:00',wakeLatest:'16:00',bed:'08:00',bedLatest:'08:00'};assert.deepEqual(taskWindows(s,date),[[0,390],[1050,1440]]);});
