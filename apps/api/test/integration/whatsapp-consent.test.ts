import { describe,it,expect } from 'vitest';
import { consentIntent,evaluateConsentPolicy,type ConsentPolicyInput } from '../../src/modules/whatsapp/consent-rules.ts';
const now=new Date('2026-09-20T12:00:00Z');
const base:ConsentPolicyInput={purpose:'updates',state:'granted',currentContact:true,pendingInbound:false,installationActive:true,
  lastInboundAt:now,requestedInboxMatches:false,now,format:'text',template:null,credentialRevision:1,variables:[]};
describe('consent commands and current policy',()=>{
  it.each(['STOP',' stop updates ','Unsubscribe'])('prioritizes %s',text=>expect(consentIntent(text)).toBe('stop'));
  it.each(['START','start   updates'])('recognizes affirmative command %s before greeting',text=>expect(consentIntent(text)).toBe('start'));
  it.each(['hello','restart','do not start updates','nonstop'])('does not infer permission from %s',text=>expect(consentIntent(text)).toBe('other'));
  it.each([
    [{state:'unknown'},'consent_unknown'],[{state:'revoked'},'consent_revoked'],[{pendingInbound:true},'consent_processing_pending'],
    [{currentContact:false},'contact_unconfirmed'],[{purpose:'delivery_otp'},'operational_exception_unapproved'],
    [{purpose:'marketing'},'purpose_unsupported'],[{installationActive:false},'installation_unavailable'],
    [{lastInboundAt:new Date(now.getTime()-86400000)},'approved_template_required'],
    [{lastInboundAt:new Date(now.getTime()+1)},'approved_template_required'],
    [{purpose:'requested_assistance',requestedInboxMatches:false},'requested_context_expired'],
  ])('denies unsafe policy %j',(patch,reason)=>expect(evaluateConsentPolicy({...base,...patch} as ConsentPolicyInput).reason).toBe(reason));
  it('allows requested assistance without subscribing to future updates',()=>{
    expect(evaluateConsentPolicy({...base,state:'unknown',purpose:'requested_assistance',requestedInboxMatches:true}).allowed).toBe(true);
  });
  it('checks approved exact template, category, freshness, credential and variables outside window',()=>{
    const input:ConsentPolicyInput={...base,lastInboundAt:null,format:'template',variables:['parcel'],template:{provider_id:'123',installation_id:'i',name:'update',language:'en',status:'APPROVED',category:'UTILITY',supported:true,shape_hash:'a',variables:[{type:'text'}],version:1,credential_revision:1,checked_at:now}};
    expect(evaluateConsentPolicy(input).allowed).toBe(true);
    expect(evaluateConsentPolicy({...input,template:{...input.template!,status:'PAUSED'}}).reason).toBe('template_not_approved');
    expect(evaluateConsentPolicy({...input,template:{...input.template!,category:'AUTHENTICATION'}}).reason).toBe('template_category_unavailable');
    expect(evaluateConsentPolicy({...input,credentialRevision:2}).reason).toBe('template_validation_stale');
    expect(evaluateConsentPolicy({...input,now:new Date(now.getTime()+900000)}).reason).toBe('template_validation_stale');
    expect(evaluateConsentPolicy({...input,variables:[]}).reason).toBe('template_variables_invalid');
  });
});
