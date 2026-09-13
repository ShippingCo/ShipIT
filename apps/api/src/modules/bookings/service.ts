import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { customerSnapshot } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import { withBookingTenantScope } from '../memberships/service.ts';
import { snapshot } from '../customers/repository.ts';
import { customerDto } from '../customers/types.ts';
import { validatePricingSnapshot } from '../pricing/service.ts';
import { validateTaxSnapshot } from '../tax/service.ts';
import { appendBooking } from '../audit/repository.ts';
import { insert as insertParcel } from '../parcels/repository.ts';
import { instant } from '../pricing/types.ts';
import { bookingDto, charges, obligation, type BookingDto } from './types.ts';
import { create, idempotencyKey } from './validation.ts';
import { fingerprint, keyDigest } from './idempotency.ts';
import { envelope, persist } from './events.ts';
import * as r from './repository.ts';
export function createBookingService(database: DatabasePool, clock?: () => Date) {
  return { create(session: string, organization: string, franchise: string, key: unknown, input: unknown, correlation: string) {
    const body = create(input), keyHash = keyDigest(idempotencyKey(key));
    return withBookingTenantScope(database,session,organization,franchise,correlation,async s => {
      try {
        const command = randomUUID(), id = randomUUID(), parcelSet = randomUUID();
        const previous = await r.reserve(s.bookings,command,id,keyHash,fingerprint(body));
        if (previous) {
          if (previous.charges.pricing.override_status === 'privileged' && s.pricing.context.action !== 'pricing.override.approve') throw new HttpError('ACTION_FORBIDDEN');
          return bookingDto(previous);
        }
        const now = clock ? clock() : await r.now(s.bookings), time = instant(now);
        const customer = await snapshot(s.customer,body.customer_id);
        if (!customer) throw new HttpError('RESOURCE_NOT_FOUND');
        if (customer.version !== body.expected_customer_version) throw new HttpError('VERSION_CONFLICT');
        const frozen = customerSnapshot(customerDto(customer));
        const pricing = await validatePricingSnapshot(s.pricing,body.tax_intent.quote_id,body.tax_intent.pricing_input,now);
        const tax = await validateTaxSnapshot(s,body.tax_calculation_id,body.tax_intent,
          {source:'trusted-contemporaneous-records',evidenceRef:command,serviceAt:now,invoiceAt:now,paymentAt:null},now);
        const result: BookingDto = { id,version:1,state:'active',organization_id:organization,franchise_id:franchise,customer:frozen,
          charges:charges(pricing,tax,time),payment_obligation:obligation(randomUUID(),tax.final_payable_paise),event_id:randomUUID(),
          parcels:body.parcels.map(p => ({ id:randomUUID(),version:1,status:'booked',custody:'awaiting_intake',docket:'',
            weight_grams:p.weight_grams,sender:frozen,recipient:p.recipient,event_id:randomUUID() })) };
        await r.insert(s.bookings,command,result,pricing,tax,body.tax_intent,parcelSet);
        for (const [index,p] of result.parcels.entries()) p.docket = await insertParcel(s.parcels,id,index+1,p,body.parcels[index]!.docket);
        await r.saveObligation(s.bookings,id,result.payment_obligation);
        await appendBooking(s.audit,id,command,time);
        await persist(s.events,envelope(s.events,command,result.event_id,'booking.created',id,time,parcelSet),id);
        for (const p of result.parcels) await persist(s.events,envelope(s.events,command,p.event_id,'parcel.booked',p.id,time,id),id);
        const dto = bookingDto(result);
        await r.complete(s.bookings,command,dto);
        return dto;
      } catch (error) {
        if (error instanceof DatabaseError && error.sqlState === '23505' && error.constraint === 'parcels_docket_key') throw new HttpError('DOCKET_CONFLICT');
        if (error instanceof DatabaseError && error.sqlState === '23514' && error.constraint === 'parcels_docket_reserved') throw new HttpError('DOCKET_CONFLICT');
        throw error;
      }
    });
  } };
}
