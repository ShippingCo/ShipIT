import { randomUUID } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { read as quote,policy } from '../customer-quotes/repository.ts';
import { referral } from '../customer-quotes/rules.ts';
import { address,windowInput,transition,expectations,type PickupDraft } from './rules.ts';
import * as repository from './repository.ts';

const reference='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const missing='No pickup or quote is available for that reference.';
const windowPrompt='Send the requested start and end with timezone, separated by |. Example: 2026-10-03T10:00:00+05:30 | 2026-10-03T12:00:00+05:30. Start within 30 days; window at most 24 hours.';
export async function pickupTurn(scope:TenantAccess,c:{inbox:string;installation:string;contact:string;conversation:string;now:Date},text:string,d:PickupDraft|null) {
 const answer=(reply:string,outcome:'answered'|'selection_required'|'not_found'|'unavailable'='answered')=>({reply,outcome});
 const own=(p:repository.Pickup|undefined)=>p?.installation_id===c.installation&&p.contact_key===c.contact;
 const clean=text.trim(),cancel=clean.match(new RegExp('^cancel pickup '+reference+' (\\d+)$','i'));
 const status=clean.match(new RegExp('^pickup status '+reference+'$','i'));
 if(status) {
  const p=await repository.get(scope,status[1]!.toLowerCase());if(!own(p))return answer(missing,'not_found');
  return answer(`Pickup ${p!.id}: ${p!.state}, version ${p!.version}.${p!.agreed_start?` Agreed window ${p!.agreed_start.toISOString()} to ${p!.agreed_end!.toISOString()}.`:''} ${expectations}`);
 }
 if(cancel) {
  const p=await repository.get(scope,cancel[1]!.toLowerCase(),true);if(!own(p))return answer(missing,'not_found');
  if(p!.state==='canceled')return answer(`Pickup ${p!.id} is canceled.`);
  try {transition(p!.state,'canceled',p!.version,Number(cancel[2]));}catch{return answer('Pickup changed or was already decided. Send PICKUPS to check; contact the franchise about an accepted request.','unavailable');}
  const updated=await repository.change(scope,p!,'canceled',null,null,null);await repository.event(scope,updated,'pickup.canceled');
  await repository.draft(scope,c.conversation,null);return answer(`Pickup ${p!.id} canceled. No booking was canceled.`);
 }
 if(/^pickups$/i.test(clean)) {
  const items=(await scopedQuery<repository.Pickup>(scope,['whatsapp.inbox.work'],`SELECT p.* FROM shipit.pickup_requests p
   WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.installation_id=$1 AND p.contact_key=$2 ORDER BY p.created_at DESC,p.id DESC LIMIT 10`,[c.installation,c.contact])).rows;
  return answer(items.length?items.map(p=>`Pickup ${p.id}: ${p.state}${p.agreed_start?`, agreed ${p.agreed_start.toISOString()} to ${p.agreed_end!.toISOString()}`:''}.${p.state==='submitted'?` To cancel send CANCEL PICKUP ${p.id} ${p.version}.`:''}`).join('\n')+'\nLatest 10 requests. Send PICKUP STATUS followed by a request reference to check an older request. '+expectations:'No pickup requests are available. Send QUOTE for shipment details first.');
 }
 const start=clean.match(new RegExp('^pickup '+reference+'$','i'));
 if(start) {
  const q=await quote(scope,start[1]!.toLowerCase(),c.installation,c.contact);if(!q)return answer(missing,'not_found');
  await repository.draft(scope,c.conversation,{quote_id:q.id,request_key:randomUUID()});
  return answer(expectations+' Send the full pickup address, including building/street, locality, city and postal code (12–500 characters). Do not include access codes.','selection_required');
 }
 const submit=clean.match(new RegExp('^submit pickup '+reference+'$','i'));
 if(submit) {
  const prior=(await scopedQuery<repository.Pickup>(scope,['whatsapp.inbox.work'],`SELECT p.* FROM shipit.pickup_requests p
   WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.installation_id=$1 AND p.contact_key=$2 AND p.request_key=$3`,[c.installation,c.contact,submit[1]!.toLowerCase()])).rows[0];
  if(prior)return answer(`Pickup ${prior.id}: ${prior.state}. ${expectations}`);
 }
 if(!d)return answer('Send PICKUP followed by your quote reference to request collection, or PICKUPS to check your requests.','unavailable');
 if(!d.address) {
  try {d={...d,address:address(clean)};}catch{return answer('Address is invalid. Send 12–500 characters including building/street, locality, city and postal code.','selection_required');}
  await repository.draft(scope,c.conversation,d);return answer(windowPrompt,'selection_required');
 }
 if(!d.window_start) {
  try {const [a,b,...extra]=clean.split('|').map(v=>v.trim());if(extra.length)throw new Error();d={...d,...windowInput(a,b,c.now)};}
  catch{return answer('Requested window is invalid. '+windowPrompt,'selection_required');}
  await repository.draft(scope,c.conversation,d);
  return answer(`Requested window ${d.window_start} to ${d.window_end}. Address saved privately. ${expectations} Send SUBMIT PICKUP ${d.request_key} to confirm. Send PICKUP with your quote reference to start again.`,'selection_required');
 }
 if(!submit||submit[1]!.toLowerCase()!==d.request_key)return answer(`Send SUBMIT PICKUP ${d.request_key} to confirm, or PICKUP with your quote reference to start again.`,'selection_required');
 try {windowInput(d.window_start,d.window_end,c.now);}catch{return answer('The requested window is no longer valid. Start again with PICKUP and your quote reference.','unavailable');}
 const q=await quote(scope,d.quote_id,c.installation,c.contact);if(!q)return answer(missing,'not_found');
 const recent=(await scopedQuery<{n:number}>(scope,['whatsapp.inbox.work'],`SELECT count(*)::integer n FROM (SELECT 1 FROM shipit.pickup_requests p
  WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.installation_id=$1 AND p.contact_key=$2 AND p.created_at>$3::timestamptz-interval '1 day' LIMIT 10) r`,[c.installation,c.contact,c.now])).rows[0]!.n;
 if(recent>=10)return answer('Pickup request limit reached. Contact the franchise or try tomorrow.','unavailable');
 const current=await policy(scope),reason=q.reason??(current?referral(current.configuration,q.input):'policy_unavailable')??(q.expires_at<=c.now||q.policy_id!==current?.id?'estimate_expired':null);
 const x=scope.context,id=randomUUID();
 const p=(await scopedQuery<repository.Pickup>(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.pickup_requests
  (id,organization_id,franchise_id,installation_id,contact_key,quote_id,inbox_id,request_key,address,window_start,window_end,review_reason)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}} RETURNING *`,
 [id,x.permittedFranchiseIds[0],c.installation,c.contact,q.id,c.inbox,d.request_key,address(d.address),d.window_start,d.window_end,reason,x.organizationId])).rows[0];
 if(!p)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 await repository.event(scope,p,'pickup.requested');await repository.draft(scope,c.conversation,null);
 return answer(`Pickup ${id} submitted${reason?' for manual review':''}. ${expectations} Send PICKUPS to check or CANCEL PICKUP ${id} 1 to cancel before a staff decision.`);
}
