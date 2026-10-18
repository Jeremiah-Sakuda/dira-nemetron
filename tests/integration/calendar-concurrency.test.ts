import {beforeEach,describe,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({list:vi.fn(),get:vi.fn(),patch:vi.fn(),delete:vi.fn()}));
vi.mock('googleapis',()=>({google:{auth:{OAuth2:class{setCredentials(){}}},calendar:()=>({events:api})}}));
import {GoogleUserCalendarTool} from '../../adapters/calendar/src/user-google-calendar.js';
import {assertReviewedCalendarOccupancy} from '../../services/orchestrator/src/calendar-occupancy.js';
import {buildAccountToolSet} from '../../services/orchestrator/src/account-tools.js';
import type {DomainState} from '@dira/commitment-model';
const start='2030-01-01T10:00:00Z',end='2030-01-01T11:00:00Z';
const event=(etag='v1')=>({id:'source',etag,start:{dateTime:start},end:{dateTime:end}});
const tool=()=>new GoogleUserCalendarTool(async()=> 'synthetic-token',async()=>true);
beforeEach(()=>{vi.resetAllMocks();api.get.mockResolvedValue({data:event()});api.list.mockResolvedValue({data:{items:[]}});});
describe('Calendar complete reads and conditional writes',()=>{
  it('reads every page in the bounded time window',async()=>{
    api.list.mockResolvedValueOnce({data:{items:[event()],nextPageToken:'page-2'}}).mockResolvedValueOnce({data:{items:[{...event(),id:'second'}]}});
    expect(await tool().getEventsInWindow(start,end)).toHaveLength(2);expect(api.list.mock.calls[1]![0]).toMatchObject({timeMin:start,timeMax:end,pageToken:'page-2'});
  });
  it('fails closed on repeated pagination',async()=>{
    api.list.mockResolvedValue({data:{items:[],nextPageToken:'repeated'}});
    await expect(tool().getEventsInWindow(start,end)).rejects.toThrow('incomplete');
  });
  it('refuses a changed ETag after the checked read',async()=>{
    api.get.mockResolvedValueOnce({data:event('v1')}).mockResolvedValueOnce({data:event('v2')});const calendar=tool();
    await calendar.verifyEvent({id:'google:source'});await expect(calendar.moveEvent('google:source',start,end)).rejects.toThrow('changed after the checked read');expect(api.patch).not.toHaveBeenCalled();
  });
  it('preserves a concurrent external edit through If-Match',async()=>{
    api.patch.mockRejectedValue(Object.assign(new Error('precondition failed'),{code:412}));
    await expect(tool().moveEvent('google:source',start,end)).rejects.toMatchObject({code:'HTTP_412',transient:false});
    expect(api.patch.mock.calls[0]![1]).toEqual({headers:{'If-Match':'v1'}});
  });
  it('requires a precondition for delete too',async()=>{
    await tool().deleteEvent('google:source');expect(api.delete.mock.calls[0]![1]).toEqual({headers:{'If-Match':'v1'}});
  });
  it('does not write without an ETag',async()=>{
    api.get.mockResolvedValue({data:{...event(),etag:undefined}});await expect(tool().moveEvent('google:source',start,end)).rejects.toThrow('no write precondition');expect(api.patch).not.toHaveBeenCalled();
  });
  it('reads cancelled and missing events as absent, not failed deletion',async()=>{
    api.get.mockResolvedValueOnce({data:{...event(),status:'cancelled'}}).mockRejectedValueOnce({code:404}).mockRejectedValueOnce({response:{status:410}});
    const calendar=tool();for(let i=0;i<3;i++)expect(await calendar.verifyEvent({id:'google:source'})).toBeNull();
  });
});
function world():DomainState{return {userId:'synthetic-owner',timezone:'UTC',horizonStartIso:'2030-01-01T00:00:00Z',horizonEndMin:1440,commitments:{known:{id:'known',externalId:'source',externalSystem:'calendar',kind:'event',status:'PLANNED',startMin:600,durationMin:60}}} as unknown as DomainState;}
const observed={id:'google:source',title:'Synthetic busy event',startIso:start,endIso:end,metadata:{googleEventId:'source'}};
describe('Unreviewed occupancy never grants authority',()=>{
  it('rejects a newly created busy event before a real-account write',async()=>{
    api.list.mockResolvedValue({data:{items:[{...event(),id:'unreviewed'}]}});
    const tools=buildAccountToolSet({kind:'google',accountId:'synthetic-owner',ownerEmail:'owner@example.com',store:{} as never,state:world,draftOnly:async()=>true,google:{accessToken:async()=> 'synthetic-token',scopes:async()=>['https://www.googleapis.com/auth/calendar.events'],calendarFenced:async()=>false}});
    await expect(tools.calendar.moveEvent('source',start,end)).rejects.toThrow('unreviewed busy time');expect(api.patch).not.toHaveBeenCalled();expect(api.get).not.toHaveBeenCalled();
  });
  it('rejects changed busy time on a different reviewed item',async()=>{
    await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[{...observed,startIso:'2030-01-01T10:30:00Z'}]},world())).rejects.toThrow('changed after review');
  });
  it('allows matching reviewed times without adding graph nodes',async()=>{
    const state=world();expect(await assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[observed]},state)).toBe(1);expect(Object.keys(state.commitments)).toEqual(['known']);
  });
  it('ignores transparent events and preserves failure on incomplete read',async()=>{
    await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>[{...observed,id:'unknown',metadata:{transparency:'transparent'}}]},world())).resolves.toBe(1);
    await expect(assertReviewedCalendarOccupancy({getEventsInWindow:async()=>{throw Error('incomplete');}},world())).rejects.toThrow('incomplete');
  });
});
