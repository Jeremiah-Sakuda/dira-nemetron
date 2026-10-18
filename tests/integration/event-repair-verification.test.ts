import {describe,it,expect} from 'vitest';
import {buildReplayRuntime,DiraOrchestrator,FixtureModelClient,InMemoryWorkflowStore,normalizeActionTimes} from '@dira/agent';
import {buildGoldenFixture} from '@dira/fixtures/golden';
import {rebaseDomainState} from '../../services/orchestrator/src/account-planning.js';
import {assertRemainingCalendarPlanFresh} from '../../services/orchestrator/src/calendar-resume.js';
import {DEFAULT_ACCOUNT_POLICY} from '../../services/orchestrator/src/account-policy.js';

describe('event-repair read-back and real-clock execution boundary',()=>{
 it.each(['end','title'])('never verifies a created event with wrong %s through the full orchestrator',async field=>{
  const fixture=buildGoldenFixture();const runtime=await buildReplayRuntime(fixture);
  const original=runtime.tools.calendar.verifyEvent.bind(runtime.tools.calendar);
  runtime.tools.calendar.verifyEvent=async query=>{
   const event=await original(query);
   if(!event || !query.id?.startsWith('cal-study-'))return event;
   return field==='end'?{...event,endIso:new Date(Date.parse(event.endIso)+60000).toISOString()}:{...event,title:'Unexpected external title'};
  };
  await runtime.orchestrator.handleEvent(fixture.trigger);
  const creates=runtime.ledger.all().filter(r=>r.action.type==='CREATE_CALENDAR_EVENT');
  expect(creates.length).toBeGreaterThan(0);
  expect(creates.filter(r=>r.status==='VERIFIED')).toHaveLength(0);
  expect(creates.some(r=>r.status==='REPLAN_REQUIRED')).toBe(true);
 });
 it('does not verify a moved event whose end differs from the approved result',async()=>{
  const fixture=buildGoldenFixture();const runtime=await buildReplayRuntime(fixture);const original=runtime.tools.calendar.verifyEvent.bind(runtime.tools.calendar);
  runtime.tools.calendar.verifyEvent=async query=>{const event=await original(query);return event && !query.id?.startsWith('cal-study-') ? {...event,endIso:new Date(Date.parse(event.endIso)+60000).toISOString()} : event;};
  await runtime.orchestrator.handleEvent(fixture.trigger);
  const moves=runtime.ledger.all().filter(r=>r.action.type==='MOVE_CALENDAR_EVENT');expect(moves.length).toBeGreaterThan(0);expect(moves.some(r=>r.status==='REPLAN_REQUIRED')).toBe(true);expect(moves.filter(r=>r.status==='VERIFIED')).toHaveLength(0);
 });
 it('preserves the absolute intent when a real account horizon rebases',()=>{
  const action={type:'MOVE_CALENDAR_EVENT' as const,target:'tuesday-workout',desired_state:{start_iso:'2030-01-02T10:00:00Z',end_iso:'2030-01-02T11:00:00Z',start_min:2040},provenance:['policy:flexibility'],external_system:'calendar' as const,summary:'Synthetic move'};
  const normalized=normalizeActionTimes(action,'2030-01-02T00:00:00Z');
  expect(normalized.desired_state.start_min).toBe(600);expect(normalized.desired_state.duration_min).toBe(60);expect(action.desired_state.start_min).toBe(2040);
 });
 it('rechecks offered-slot policy with normalized offsets after rebasing',async()=>{
  const {evaluateAction}=await import('@dira/policy-engine');const fixture=buildGoldenFixture();const state=fixture.state;const target='technical-interview-1';const slot=state.approvedSlots[target]![0]!;
  const action={type:'BOOK_INTERVIEW_SLOT' as const,target,desired_state:{start_min:slot.startMin,start_iso:new Date(Date.parse(state.horizonStartIso)+slot.startMin*60000).toISOString(),end_iso:new Date(Date.parse(state.horizonStartIso)+(slot.startMin+slot.durationMin)*60000).toISOString()},provenance:[slot.provenance],external_system:'recruiter' as const,summary:'Rebased booking'};
  const fresh=rebaseDomainState(state,new Date(Date.parse(state.horizonStartIso)+3600000));
  expect(evaluateAction(fresh,action).verdict).toBe('DENY');expect(evaluateAction(fresh,normalizeActionTimes(action,fresh.horizonStartIso)).verdict).toBe('ALLOW');
 });
 it('an expired real-clock approved plan makes zero external mutations',async()=>{
  const fixture=buildGoldenFixture();const runtime=await buildReplayRuntime(fixture);const workflows=new InMemoryWorkflowStore();
  let saved=structuredClone(fixture.state);let now=new Date(fixture.trigger.receivedAtIso);
  const make=(state=structuredClone(saved))=>new DiraOrchestrator(state,runtime.tools,runtime.ledger,runtime.recorder,new FixtureModelClient({[fixture.trigger.messageId]:fixture.interpretation}),workflows,{
   approvals:true,policyOverrides:[{rule:'delegate-explicitly-delegatable'}],executionClock:()=>now,
   beforeExternalAction:async(_record,remaining,current)=>{assertRemainingCalendarPlanFresh(current,{weekdays:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440},remaining,DEFAULT_ACCOUNT_POLICY,now);},
   onStateCommitted:async next=>{saved=structuredClone(next);},
  });
  const first=await make().handleEvent(fixture.trigger);expect(first.status).toBe('AWAITING_APPROVAL');
  for(const record of runtime.ledger.byWorkflow(first.id).filter(r=>r.status==='AWAITING_APPROVAL'))await runtime.ledger.transition(record.actionId,'AUTHORIZED',{approval:{decision:'APPROVED',source:'authenticated-web',actorAccountId:fixture.state.userId,decisionAtIso:now.toISOString()}});
  now=new Date(Date.parse(fixture.state.horizonStartIso)+10*86400000);
  const resumed=await make(rebaseDomainState(saved,now)).resumeAfterApproval(first.id,now.toISOString());
  expect(resumed.status).not.toBe('RESOLVED');expect(runtime.tools.calendar.mutationLog).toHaveLength(0);expect(runtime.tools.recruiter.bookAttempts).toHaveLength(0);expect(runtime.tools.org.mutationLog).toHaveLength(0);
 });
});
