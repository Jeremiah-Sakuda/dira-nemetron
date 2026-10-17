import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({list:vi.fn(),get:vi.fn(),create:vi.fn(),send:vi.fn()}));
vi.mock('googleapis', () => ({google:{auth:{OAuth2:class {setCredentials() {}}},gmail:()=>({users:{messages:{list:calls.list,get:calls.get,send:calls.send},drafts:{create:calls.create}}})}}));
import { deterministicMessageId, GoogleUserMailTool, GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE } from '../../adapters/gmail/src/user-google-mail.js';

const to='owner@example.com', body='Synthetic update. Dira is acting on behalf of Owner.', subject='Synthetic draft verification';
const key=deterministicMessageId('fixture-thread',to,body);
const options={to,body,subject};
const message=(overrides:Record<string,unknown>={})=>({id:'provider-id',labelIds:['DRAFT'],payload:{headers:[
  {name:'To',value:to},{name:'Subject',value:subject},
  {name:'Message-ID',value:'<rewritten@mail.gmail.com>'},
  {name:'X-Dira-Idempotency-Key',value:key},{name:'X-Dira-Sent-On-Behalf',value:'true'},
],body:{data:Buffer.from(body).toString('base64url')}},...overrides});
const tool=()=>new GoogleUserMailTool(async()=> 'synthetic-token',{
  allowedRecipients:async()=>new Set([to]),draftOnly:async()=>true,
  ownerName:async()=> 'Owner',ownerEmail:async()=>to,
},async()=>[GMAIL_COMPOSE_SCOPE,GMAIL_READONLY_SCOPE]);
beforeEach(()=>{vi.resetAllMocks();calls.list.mockResolvedValue({data:{messages:[]}});calls.get.mockResolvedValue({data:message()});calls.create.mockResolvedValue({data:{message:{id:'provider-id'}}});});
describe('Gmail draft verification with provider-rewritten Message-ID',()=>{
  it('freshly GETs the durable provider receipt and checks full content',async()=>{
    expect(await tool().verifyReply('fixture-thread','Synthetic update',{...options,messageId:'provider-id'})).toBe(true);
    expect(calls.get).toHaveBeenCalledWith({userId:'me',id:'provider-id',format:'full'});
    expect(calls.list).not.toHaveBeenCalled();
  });
  it('recovers a rewritten draft without another create or send',async()=>{
    calls.list.mockResolvedValueOnce({data:{messages:[]}}).mockResolvedValueOnce({data:{messages:[{id:'provider-id'}]}});
    expect(await tool().sendReply('fixture-thread',to,body,{subject})).toEqual({messageId:'provider-id',mode:'draft'});
    expect(calls.create).not.toHaveBeenCalled();expect(calls.send).not.toHaveBeenCalled();
    expect(calls.list.mock.calls[1]![0].q).toContain('in:drafts to:"owner@example.com" subject:"Synthetic draft verification"');
  });
  it('adds a preserved idempotency header to new drafts',async()=>{
    await tool().sendReply('fixture-thread',to,body,{subject});
    const raw=Buffer.from(calls.create.mock.calls[0]![0].requestBody.message.raw,'base64url').toString('utf8');
    expect(raw).toContain('X-Dira-Idempotency-Key: '+key);expect(calls.send).not.toHaveBeenCalled();
  });
  it('rejects an extra recipient even with the right provider receipt',async()=>{
    const changed=message();changed.payload.headers[0]!.value=to+', outsider@example.com';calls.get.mockResolvedValue({data:changed});
    expect(await tool().verifyReply('fixture-thread','Synthetic', {...options,messageId:'provider-id'})).toBe(false);
  });
  it('rejects a partial body match',async()=>{
    const changed=message();changed.payload.body.data=Buffer.from(body+' Unexpected extra content.').toString('base64url');calls.get.mockResolvedValue({data:changed});
    expect(await tool().verifyReply('fixture-thread','Synthetic', {...options,messageId:'provider-id'})).toBe(false);
  });
  it('rejects a different action key',async()=>{
    const changed=message();changed.payload.headers.find(h=>h.name==='X-Dira-Idempotency-Key')!.value='another-action';calls.get.mockResolvedValue({data:changed});
    expect(await tool().verifyReply('fixture-thread','Synthetic', {...options,messageId:'provider-id'})).toBe(false);
  });
  it('fails closed if targeted recovery results exceed the bound',async()=>{
    calls.list.mockResolvedValueOnce({data:{messages:[]}}).mockResolvedValueOnce({data:{messages:[],nextPageToken:'more'}});
    await expect(tool().sendReply('fixture-thread',to,body,{subject})).rejects.toThrow('refusing to create another message');
    expect(calls.create).not.toHaveBeenCalled();
  });
  it('recovers old disclosed drafts using exact recipient, subject and body',async()=>{
    const old=message();old.payload.headers=old.payload.headers.filter(h=>h.name!=='X-Dira-Idempotency-Key');calls.get.mockResolvedValue({data:old});
    calls.list.mockResolvedValueOnce({data:{messages:[]}}).mockResolvedValueOnce({data:{messages:[{id:'provider-id'}]}});
    expect(await tool().sendReply('fixture-thread',to,body,{subject})).toEqual({messageId:'provider-id',mode:'draft'});
    expect(calls.create).not.toHaveBeenCalled();
  });
});
