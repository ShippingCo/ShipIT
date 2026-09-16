import { paymentSetup } from './payment-support.ts';
import { org,A } from './audit-support.ts';
export async function receiptSetup(t:Parameters<typeof paymentSetup>[0]) {
 const s=await paymentSetup(t);await s.db.prepareReceipts();
 const receipt=(payment?:string,actor:{id:string;token:string}=s.local,booking=s.bookingId,organization=org,franchise=A)=>s.request('GET',booking+(payment?'/payments/'+payment:'')+'/receipt',undefined,actor,undefined,organization,franchise);
 const direct=(id:string,actor:{id:string;token:string}=s.local,organization=org,franchise=A)=>s.app.inject({method:'GET',url:'/api/v1/receipts/'+id+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),cookies:s.cookies(actor.token)});
 const effects=async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.issued_receipts) receipts,
  (SELECT count(*)::int FROM shipit.receipt_audit_events) receipt_audits,(SELECT count(*)::int FROM shipit.domain_events) events,
  (SELECT count(*)::int FROM shipit.payment_entries) payments,(SELECT count(*)::int FROM shipit.payment_audit_events) payment_audits,
  (SELECT count(*)::int FROM shipit.booking_audit_events) booking_audits,
  (SELECT count(*)::int FROM shipit.auth_delivery_jobs) outbound_auth_jobs`)).rows[0];
 return {...s,receipt,direct,effects};
}
