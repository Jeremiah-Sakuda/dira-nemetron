import {describe,it,expect} from 'vitest';
import type {ActionRecord} from '@dira/action-ledger';
import {buildGoldenFixture} from '@dira/fixtures/golden';
import {googleEventIdFor} from '@dira/adapter-calendar/user-google';
import {assertRemainingCalendarPlanFresh,verifiedCalendarState,createdCalendarIntent} from '../../services/orchestrator/src/calendar-resume.js';
import {calendarProviderId,calendarReceipt} from '../../services/orchestrator/src/calendar-receipt.js';
import {assertReviewedCalendarOccupancy} from '../../services/orchestrator/src/calendar-occupancy.js';
import {DEFAULT_ACCOUNT_POLICY} from '../../services/orchestrator/src/account-policy.js';
import {monitoringState} from '../../services/orchestrator/src/account-monitoring.js';
const logicalId='synthetic-create',providerId=googleEventIdFor(logicalId);
const start='2030-01-02T10:00:00Z',end='2030-01-02T11:00:00Z';
function create(status='VERIFIED'):ActionRecord{return {actionId:'create',status,idempotencyKey:logicalId,planSeq:0,externalResponse:{kind:'google-calendar',logicalId,googleEventId:providerId},action:{type:'CREATE_CALENDAR_EVENT',target:'new-block',desired_state:{title:'Synthetic',start_iso:start,end_iso:end,start_min:2040,duration_min:60},summary:'Synthetic create'}} as unknown as ActionRecord;}
const state=()=>({...buildGoldenFixture({horizonStartIso:'2030-01-01T00:00:00Z'}).state});
const profile={weekdays:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440};
describe('Calendar retry guards and distinct provider receipts',()=>{
 it('recovers provider identity from a fresh read instead of the logical id',()=>{
  const event={id:logicalId,title:'Synthetic',startIso:start,endIso:end,metadata:{googleEventId:providerId}};
  expect(calendarProviderId(event)).toBe(providerId);expect(calendarReceipt(event,logicalId)).toEqual({kind:'google-calendar',logicalId,googleEventId:providerId});
  expect(calendarProviderId({id:logicalId,startIso:start})).toBeUndefined();expect(calendarProviderId({id:providerId})).toBe(providerId);
  expect(()=>calendarReceipt({...event,id:'wrong'},logicalId)).toThrow('identity');
 });
 it('reconstructs verified creates with the real source reference',()=>{
  expect(verifiedCalendarState(state(),[create()]).commitments['new-block']?.externalId).toBe(providerId);
 });
 it.each([undefined,'invalid','2030-01-02T10:00:00Z','2030-01-02T09:00:00Z'])(
  'rejects malformed approved intervals during recovery and before execution: %s',endIso=>{
   const record=create();record.action.desired_state.end_iso=endIso;
   expect(()=>verifiedCalendarState(state(),[record])).toThrow('Scheduled action');
   record.status='AUTHORIZED';
   expect(()=>assertRemainingCalendarPlanFresh(state(),profile,[record],DEFAULT_ACCOUNT_POLICY,new Date('2030-01-01T12:00:00Z'))).toThrow('Scheduled action');
  });
 it.each([false,true])('rejects a past slot on transient retry, completed sibling=%s',completed=>{
  const pending=create('FAILED_TRANSIENT');pending.actionId='pending';pending.action.target='pending-block';
  const records=completed?[create(),pending]:[pending];
  expect(()=>assertRemainingCalendarPlanFresh(state(),profile,records,DEFAULT_ACCOUNT_POLICY,new Date('2030-01-02T12:00:00Z'))).toThrow('slot has passed');
  expect(records[0]?.status).toBe(completed?'VERIFIED':'FAILED_TRANSIENT');
 });
 it('does not replay completed effects even after their slot passes',()=>{
  expect(assertRemainingCalendarPlanFresh(state(),profile,[create()],DEFAULT_ACCOUNT_POLICY,new Date('2030-01-03T12:00:00Z')).commitments['new-block']?.externalId).toBe(providerId);
 });
 it('allows a matching created busy event and blocks its external move or wrong identity',async()=>{
  const intent=createdCalendarIntent(create());const s=state();const read={id:logicalId,title:'Synthetic',startIso:start,endIso:end,metadata:{googleEventId:providerId}};
  await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[read]},s,[intent])).resolves.toBe(1);
  await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[{...read,startIso:'2030-01-02T10:30:00Z'}]},s,[intent])).rejects.toThrow('changed after approval');
  await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[{...read,metadata:{googleEventId:'wrong'}}]},s,[intent])).rejects.toThrow('changed after approval');
  await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[read]},s)).rejects.toThrow('unreviewed');
 });
 it('distinguishes disconnected, fenced, opted-out, unenrolled and scheduled monitoring',()=>{
  const base={connected:true,fenced:false,optedIn:true,enrolled:true};
  expect(monitoringState(base)).toBe('scheduled');expect(monitoringState({...base,connected:false})).toBe('disconnected');
  expect(monitoringState({...base,fenced:true})).toBe('fenced');expect(monitoringState({...base,optedIn:false})).toBe('paused by you');expect(monitoringState({...base,enrolled:false})).toBe('awaiting deployment enrollment');
 });
});
