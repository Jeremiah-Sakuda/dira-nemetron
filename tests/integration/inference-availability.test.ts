import {describe,expect,it} from 'vitest';
import {inferenceAvailability} from '../../services/orchestrator/src/inference-budget.js';
const limits={total:100,daily:20,hourly:12,concurrent:2};
const now=Date.parse('2030-01-01T12:00:00Z');
describe('budget availability is distinct from configuration',()=>{
  it('shows available with room in every window',()=>{expect(inferenceAvailability(limits,{total:1,daily:1,hourly:1,concurrent:0},[],now).available).toBe(true);});
  it('does not promise a reset for total exhaustion',()=>{expect(inferenceAvailability(limits,{total:100,daily:0,hourly:0,concurrent:0},[],now)).toMatchObject({available:false,resetsAtIso:null});});
  it('uses the correct hourly boundary',()=>{const rows=Array.from({length:12},(_,i)=>({started_at:new Date(now-300000+i*1000),status:'succeeded'}));expect(inferenceAvailability(limits,{total:12,daily:12,hourly:12,concurrent:0},rows,now)).toMatchObject({available:false,resetsAtIso:new Date(now+3300000).toISOString()});});
  it('waits for all exhausted windows and concurrent leases',()=>{const rows=[{started_at:new Date(now-10000),status:'reserved'},{started_at:new Date(now-5000),status:'reserved'}];expect(inferenceAvailability(limits,{total:2,daily:2,hourly:2,concurrent:2},rows,now).resetsAtIso).toBe(new Date(now+80000).toISOString());});
});
