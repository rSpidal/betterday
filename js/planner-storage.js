import { assertPlanner } from './planner.js?v=20261102';

export const PLANNER_STORAGE_KEY = 'betterday.planner.v2';
export const PLANNER_BACKUP_KEY = 'betterday.planner.v2.backup';
export const LEGACY_BACKUP_KEY = 'betterday.v1.backup-before-planner';
export const PLANNER_RECOVERY_KEY = 'betterday.planner.v2.recovery';
export const ROUTINE_REPLACEMENT_JOURNAL_KEY = 'betterday.routine-replacement.pending';
const ROUTINE_KEYS = ['betterday.v1', PLANNER_STORAGE_KEY, PLANNER_BACKUP_KEY, PLANNER_RECOVERY_KEY];

function parse(raw) { const state = JSON.parse(raw); assertPlanner(state); return state; }

function restoreKeys(previous,storage) {
  let failed=false;
  for(const key of ROUTINE_KEYS) {
    try { if(previous[key]===null) storage.removeItem(key); else storage.setItem(key,previous[key]); }
    catch { failed=true; }
  }
  if(failed) throw new Error('Recovery could not restore every saved copy.');
}
function recoverRoutineReplacement(storage) {
  const raw=storage.getItem(ROUTINE_REPLACEMENT_JOURNAL_KEY);
  if(!raw) return {changed:false,error:''};
  let journal;
  try {
    journal=JSON.parse(raw);
    if(journal.version!==1 || !['prepared','committed'].includes(journal.phase) || !journal.previous || !ROUTINE_KEYS.every(key=>journal.previous[key]===null || typeof journal.previous[key]==='string')) throw new Error('Invalid journal');
  } catch {throw new Error('An interrupted routine update needs recovery. Its saved copies have been kept. Download your data before making more changes.');}
  if(journal.phase==='committed') {
    try {storage.removeItem(ROUTINE_REPLACEMENT_JOURNAL_KEY);} catch { /* Committed marker prevents rolling back a successful update. */ }
    return {changed:false,error:''};
  }
  try {
    restoreKeys(journal.previous,storage);
    storage.removeItem(ROUTINE_REPLACEMENT_JOURNAL_KEY);
    return {changed:true,error:'An interrupted routine update was rolled back. Your previous schedule and questionnaire draft have been restored.'};
  } catch {throw new Error('An interrupted routine update could not be recovered because this browser blocked saving. The recovery copies have been kept; restore browser storage access and reload before editing.');}
}
function preservePreviousPlanner(previous,storage) {
  if(!previous) return;
  let valid=true;
  try {parse(previous);} catch {valid=false;}
  storage.setItem(valid?PLANNER_BACKUP_KEY:PLANNER_RECOVERY_KEY,previous);
}

/** Atomically replace the weekly template and dated plan using a durable rollback journal. */
export function saveRoutineReplacement(nextLegacy,nextPlanner,storage=globalThis.localStorage) {
  let previous,prepared=false;
  try {
    const recovery=recoverRoutineReplacement(storage);
    if(recovery.changed) return {saved:false,error:recovery.error+' Reload before trying the update again.'};
    assertPlanner(nextPlanner);
    if(!nextLegacy || nextLegacy.version!==1 || !nextLegacy.answers || !nextLegacy.schedule) throw new Error('The replacement questionnaire is incomplete.');
    const legacyRaw=JSON.stringify(nextLegacy),plannerRaw=JSON.stringify(nextPlanner);
    previous=Object.fromEntries(ROUTINE_KEYS.map(key=>[key,storage.getItem(key)]));
    const journal={version:1,phase:'prepared',previous};
    storage.setItem(ROUTINE_REPLACEMENT_JOURNAL_KEY,JSON.stringify(journal));prepared=true;
    preservePreviousPlanner(previous[PLANNER_STORAGE_KEY],storage);
    storage.setItem(PLANNER_STORAGE_KEY,plannerRaw);
    storage.setItem('betterday.v1',legacyRaw);
    storage.setItem(ROUTINE_REPLACEMENT_JOURNAL_KEY,JSON.stringify({...journal,phase:'committed'}));
    try {storage.removeItem(ROUTINE_REPLACEMENT_JOURNAL_KEY);} catch { /* Safe to clean up on the next load. */ }
    return {saved:true,error:''};
  } catch(error) {
    if(!prepared) return {saved:false,error:error?.message?.includes('recovery')?error.message:'This browser could not save the updated routine. Your existing routine and draft have been kept.'};
    try {
      restoreKeys(previous,storage);
      storage.removeItem(ROUTINE_REPLACEMENT_JOURNAL_KEY);
      return {saved:false,error:'This browser could not save the updated routine. Your previous routine, dated plan, and draft have been restored.'};
    } catch {
      return {saved:false,error:'The routine update was interrupted and recovery is incomplete. Recovery copies have been kept. Restore browser storage access and reload before making more changes.'};
    }
  }
}

/** Loading never deletes or overwrites unreadable data. */
export function loadPlanner(storage = globalThis.localStorage) {
  try {
    const recovery = recoverRoutineReplacement(storage);
    const raw = storage.getItem(PLANNER_STORAGE_KEY);
    if (!raw) return { state: null, error: recovery.error };
    try { return { state: parse(raw), error: recovery.error }; }
    catch {
      const backup = storage.getItem(PLANNER_BACKUP_KEY);
      if (backup) {
        try { return { state: parse(backup), error: 'Your latest planner could not be read. The previous saved version has been recovered, and the unreadable copy has been kept.' }; } catch { /* Keep both copies for recovery. */ }
      }
      return { state: null, error: 'Your saved planner could not be read. The original data has been kept. Restore a backup before starting over.' };
    }
  } catch(error) { return { state: null, error: error?.message?.includes('routine update') ? error.message : 'This browser could not open saved plans. Changes may not survive closing or refreshing the page.' }; }
}

export function savePlanner(state, storage = globalThis.localStorage) {
  try {
    const recovery = recoverRoutineReplacement(storage);
    if(recovery.changed) return false;
    assertPlanner(state);
    const raw = JSON.stringify(state), previous = storage.getItem(PLANNER_STORAGE_KEY);
    if (previous && previous !== raw) {
      preservePreviousPlanner(previous,storage);
    }
    storage.setItem(PLANNER_STORAGE_KEY, raw);
    return true;
  } catch { return false; }
}

/** Preserve the original weekly routine before creating its dated counterpart. */
export function saveMigratedPlanner(legacy, planner, storage = globalThis.localStorage) {
  try {
    assertPlanner(planner);
    if (!storage.getItem(LEGACY_BACKUP_KEY)) {
      storage.setItem(LEGACY_BACKUP_KEY, storage.getItem('betterday.v1') || JSON.stringify(legacy));
    }
    return savePlanner(planner, storage);
  } catch { return false; }
}

export function exportPlannerBackup(state) { assertPlanner(state); return JSON.stringify(state, null, 2); }
export function importPlannerBackup(text) {
  if (typeof text !== 'string' || text.length > 15_000_000) throw new Error('Choose a BetterDay backup smaller than 15 MB.');
  try { return parse(text); } catch { throw new Error('This file is not a valid BetterDay planner backup. Your current plan has not changed.'); }
}
