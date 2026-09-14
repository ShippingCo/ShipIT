import { createHash,randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { customerSnapshot } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import { withBookingTenantScope,withShipmentReadScope } from '../memberships/service.ts';
import { snapshot } from '../customers/repository.ts';
import { customerDto } from '../customers/types.ts';
import { validatePricingSnapshot } from '../pricing/service.ts';
import { validateTaxSnapshot } from '../tax/service.ts';
import { appendBooking } from '../audit/repository.ts';
import { insert as insertParcel } from '../parcels/repository.ts';
import { instant } from '../pricing/types.ts';
import { bookingDto,charges,obligation,parcelReadDto,timelineDto,type BookingDto,type ParcelBoundary } from './types.ts';
import { create,idempotencyKey,parcelList,parcelSelection,parcelId } from './validation.ts';
import { fingerprint, keyDigest } from './idempotency.ts';
import { envelope, persist } from './events.ts';
import * as r from './repository.ts';
import { parcelCursorCodec } from './cursor.ts';
export function createBookingService(database: DatabasePool, cursorKey:Buffer, clock?: () => Date) {
  const codec=parcelCursorCodec(cursorKey);
  return {
    async list(session:string,input:unknown,correlation:string) {
      const filter=parcelList(input);
      return withShipmentReadScope(database,session,filter.organizationId,filter.franchiseId,'parcels.list',correlation,async (scope,revision)=>{
        const binding=createHash('sha256').update(JSON.stringify({actor:scope.context.actor,organization:scope.context.organizationId,
          franchises:scope.context.permittedFranchiseIds,revision,filter:{...filter,cursor:null},version:1})).digest('hex');
        const boundary=filter.cursor?codec.decode(filter.cursor,binding):null;
        if(boundary) {
          const valid=filter.sort.startsWith('created_at')
            ? /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(boundary.value)&&Number.isFinite(Date.parse(boundary.value))
            : /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(boundary.value);
          if(!valid)throw new HttpError('CURSOR_INVALID');
        }
        const rows=await r.listParcels(scope,filter,boundary),visible=rows.slice(0,filter.limit),last=visible.at(-1),hasMore=rows.length>filter.limit;
        const value=(row:NonNullable<typeof last>)=>filter.sort.startsWith('created_at')?row.confirmed_at.toISOString():row.docket;
        return {items:visible.map(parcelReadDto),page:{has_more:hasMore,next_cursor:hasMore&&last
          ?codec.encode(binding,{value:value(last),id:last.id} satisfies ParcelBoundary):null}};
      });
    },
    async read(session:string,idInput:unknown,input:unknown,correlation:string) {
      const id=parcelId(idInput),selection=parcelSelection(input);
      return withShipmentReadScope(database,session,selection.organizationId,selection.franchiseId,'parcels.read',correlation,async scope=>{
        const row=await r.findParcel(scope,id);if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return parcelReadDto(row);
      });
    },
    async timeline(session:string,idInput:unknown,input:unknown,correlation:string) {
      const id=parcelId(idInput),selection=parcelSelection(input);
      return withShipmentReadScope(database,session,selection.organizationId,selection.franchiseId,'parcels.timeline',correlation,async scope=>{
        if(!await r.findParcel(scope,id))throw new HttpError('RESOURCE_NOT_FOUND');
        return {items:(await r.parcelTimeline(scope,id)).map(timelineDto)};
      });
    },
    create(session: string, organization: string, franchise: string, key: unknown, input: unknown, correlation: string) {
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
    }
  };
}
