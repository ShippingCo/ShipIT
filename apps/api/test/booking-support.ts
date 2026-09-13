import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { taxSetup } from './tax-support.ts';
import { contact } from './customer-support.ts';
import { org, A } from './audit-support.ts';
import { createCustomerService } from '../src/modules/customers/service.ts';
import { createBookingService } from '../src/modules/bookings/service.ts';
export async function bookingSetup(t: TestContext) {
  const s = await taxSetup(t); await s.db.prepareBookings(); await s.published();
  const customer = createCustomerService(s.pool,s.keys.browser);
  const source = await customer.create(s.operator.token,org,A,randomUUID(),contact,randomUUID());
  const prepared = await s.prepared();
  const calculated = await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:prepared.intent.id},randomUUID());
  const body = {customer_id:source.id,expected_customer_version:1,tax_calculation_id:calculated.id,tax_intent:prepared.body,
    parcels:[{weight_grams:999,recipient:{name:'Synthetic Recipient',phone:'+1 202-555-0101',address:'21 Fictional Street'}}]};
  const booking = createBookingService(s.pool,s.clock);
  const post = (input:unknown=body,key:string=randomUUID(),token=s.operator.token,franchise=A,organization=org) => s.app.inject({method:'POST',
    url:'/api/v1/bookings?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(token),payload:JSON.stringify(input)});
  const counts = async () => (await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.bookings) AS bookings,
    (SELECT count(*)::int FROM shipit.parcels) AS parcels,(SELECT count(*)::int FROM shipit.booking_obligations) AS obligations,
    (SELECT count(*)::int FROM shipit.booking_commands) AS commands,(SELECT count(*)::int FROM shipit.booking_audit_events) AS audits,
    (SELECT count(*)::int FROM shipit.domain_events) AS events`)).rows[0];
  return {...s,customer,source,body,booking,book:post,counts};
}
