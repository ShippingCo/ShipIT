import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { bookingSetup } from './booking-support.ts';
import { org, A } from './audit-support.ts';
export const referenceInput=(installation:string)=>({installation_id:installation,external_docket:'SYN-54',service_code:'STD',
  origin_code:'ORIGIN',destination_code:'UNKNOWN',expected_version:0,reason_code:'initial_mapping'});
export const observationInput=(reference:string)=>({reference_id:reference,expected_parcel_version:1,status_code:'MOVING',
  status:'in_transit_claim',occurred_at:{state:'unknown',reason:'unknown_timezone'}});
export async function carrierSetup(t:Parameters<typeof bookingSetup>[0]) {
  const s=await bookingSetup(t);await s.db.prepareCarriers();
  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const parcel=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.parcels WHERE booking_id=$1',[booked.json().id])).rows[0]!.id;
  const q={organization_id:org,franchise_id:A};
  function request(method:'GET'|'POST',path:string,body?:unknown,token=s.local.token,key=randomUUID(),query:Record<string,string>=q) {
    return s.app.inject({method,url:'/api/v1/'+path+'?'+new URLSearchParams(query),headers:{...s.headers,...(method==='POST'?{'idempotency-key':key}:{})},
      cookies:s.cookies(token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  }
  const install=()=>request('POST','carriers/installations',{label:'SYN-CARRIER'});
  const link=(installation:string,body=referenceInput(installation),key=randomUUID(),id=parcel)=>request('POST',`parcels/${id}/carriers/references`,body,s.local.token,key);
  const observe=(reference:string,body:unknown=observationInput(reference),key=randomUUID())=>request('POST',`parcels/${parcel}/carriers/observations`,body,s.local.token,key);
  const counts=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.carrier_commands) commands,
    (SELECT count(*)::int FROM shipit.carrier_references) refs,(SELECT count(*)::int FROM shipit.carrier_observations) observations,
    (SELECT count(*)::int FROM shipit.audit_history WHERE resource_type='carrier') audits`)).rows[0];
  return {...s,parcel,q,request,install,link,observe,carrierCounts:counts};
}
