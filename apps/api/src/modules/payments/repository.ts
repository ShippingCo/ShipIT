import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { instant } from '../pricing/types.ts';
import { balance } from './rules.ts';
import type { LedgerRow, ObligationRow, PaymentProjection, PaymentEntryDto, PaymentResult, PaymentCollectionInput, PaymentReversalInput } from './types.ts';
function context(scope:TenantAccess) {return assertTenantAccess(scope,['payments.collect','payments.reverse','payments.read','payments.receipt.read']);}
export async function active(scope:TenantAccess) {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse']);
  const row=(await scopedQuery<{lifecycle:string;now:Date}>(scope,[c.action],`SELECT lifecycle,date_trunc('milliseconds',clock_timestamp()) AS now
    FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
  return instant(row.now);
}
export async function obligation(scope:TenantAccess,booking:string,lock=false):Promise<ObligationRow> {
  const c=context(scope);
  const row=(await scopedQuery<ObligationRow>(scope,[c.action],`SELECT o.id,o.booking_id,o.total_paise FROM shipit.booking_obligations o
    WHERE {{franchise:o.organization_id:o.franchise_id}} AND o.booking_id=$1 ${lock?'FOR UPDATE OF o':''}`,[booking])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function projection(scope:TenantAccess,o:ObligationRow):Promise<PaymentProjection> {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse','payments.read']);
  const row=(await scopedQuery<{collected:string;version:number}>(scope,[c.action],`SELECT
    COALESCE(sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END),0)::text AS collected,
    COALESCE(max(sequence),0)::integer AS version FROM shipit.payment_entries
    WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND obligation_id=$2`,[o.booking_id,o.id])).rows[0]!;
  return {booking_id:o.booking_id,obligation_id:o.id,currency:'INR',...balance(BigInt(o.total_paise),BigInt(row.collected)),version:row.version};
}
export async function entry(scope:TenantAccess,o:ObligationRow,id:string) {
  const c=context(scope),row=(await scopedQuery<LedgerRow>(scope,[c.action],`SELECT e.* FROM shipit.payment_entries e
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.booking_id=$1 AND e.obligation_id=$2 AND e.id=$3`,[o.booking_id,o.id,id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function reversed(scope:TenantAccess,o:ObligationRow,id:string) {
  const row=(await scopedQuery<{amount:string}>(scope,['payments.reverse'],`SELECT COALESCE(sum(amount_paise::numeric),0)::text AS amount
    FROM shipit.payment_entries WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND obligation_id=$2 AND reversal_of=$3`,[o.booking_id,o.id,id])).rows[0]!;
  return BigInt(row.amount);
}
export async function replay(scope:TenantAccess,key:string) {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse']);
  return (await scopedQuery<{fingerprint:string;result:PaymentResult|null}>(scope,[c.action],`SELECT fingerprint,result FROM shipit.payment_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation_id=$2 AND key_digest=$3 FOR UPDATE`,
    [c.actor.id,'api.v1.'+c.action,key])).rows[0];
}
export async function reference(scope:TenantAccess,reference:string) {
  return (await scopedQuery<{fingerprint:string;result:PaymentResult}>(scope,['payments.collect'],`SELECT c.fingerprint,c.result
    FROM shipit.payment_entries e JOIN shipit.payment_commands c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.command_id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.collection_reference=$1 AND e.kind='collection'`,[reference])).rows[0];
}
export async function reserve(scope:TenantAccess,id:string,o:ObligationRow,key:string,fingerprint:string,input:PaymentCollectionInput|PaymentReversalInput,target:string|null,time:string) {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse']);
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.payment_commands
    (id,organization_id,franchise_id,principal_id,booking_id,obligation_id,operation_id,key_digest,fingerprint,input,reversal_of,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
    [id,c.permittedFranchiseIds[0],c.actor.id,o.booking_id,o.id,'api.v1.'+c.action,key,fingerprint,input,target,c.correlationId,time,c.organizationId]);
}
export async function append(scope:TenantAccess,command:string,id:string,o:ObligationRow,sequence:number,input:PaymentCollectionInput|PaymentReversalInput,target:LedgerRow|null,time:string) {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse']);
  const collection='method' in input?input:null;
  const inserted=await scopedQuery(scope,[c.action],`INSERT INTO shipit.payment_entries
    (id,organization_id,franchise_id,booking_id,obligation_id,command_id,kind,amount_paise,currency,context,method,collection_reference,reversal_of,reason_code,sequence,actor_id,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'INR',$8,$9,$10,$11,$12,$13,$14,$15,$16 WHERE {{franchise:$17:$2}}`,
    [id,c.permittedFranchiseIds[0],o.booking_id,o.id,command,target?'reversal':'collection',input.amount_paise,
      collection?.context??target!.context,collection?.method??target!.method,collection?.collection_reference??null,target?.id??null,
      'reason_code' in input?input.reason_code:null,sequence,c.actor.id,c.correlationId,time,c.organizationId]);
  if(inserted.rowCount!==1)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return entry(scope,o,id);
}
export async function finish(scope:TenantAccess,command:string,result:PaymentResult) {
  const c=assertTenantAccess(scope,['payments.collect','payments.reverse']);
  await scopedQuery(scope,[c.action],`UPDATE shipit.payment_commands SET state='committed',entry_id=$2,http_status=200,result=$3,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until='infinity'::timestamptz
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[command,result.entry.id,result]);
}
export function entryDto(e:LedgerRow):PaymentEntryDto {
  return {id:e.id,kind:e.kind,amount_paise:Number(e.amount_paise),currency:e.currency,context:e.context,method:e.method,
    collection_reference:e.collection_reference,reversal_of:e.reversal_of,reason_code:e.reason_code,version:e.sequence,occurred_at:instant(e.occurred_at)};
}
export async function settled(scope:TenantAccess,result:PaymentResult,command:string,event:string,time:string) {
  const c=assertTenantAccess(scope,['payments.events']),p=result.payment;
  const envelope={event_id:event,event_type:'payment.settled',schema_version:1,organization_id:c.organizationId,franchise_id:c.permittedFranchiseIds[0],
    aggregate_type:'payment_obligation',aggregate_id:p.obligation_id,aggregate_version:p.version,occurred_at:time,actor:c.actor,
    correlation_id:c.correlationId,causation_id:command,command_id:command,payload:{booking_id:p.booking_id,settlement_ref:result.entry.id}};
  await scopedQuery(scope,['payments.events'],`INSERT INTO shipit.domain_events
    (event_id,organization_id,franchise_id,booking_id,command_id,payment_command_id,obligation_id,event_type,aggregate_id,envelope)
    SELECT $1,{{organization}},$2,$3,$4,$4,$5,'payment.settled',$5,$6 WHERE {{franchise:$7:$2}}`,
    [event,c.permittedFranchiseIds[0],p.booking_id,command,p.obligation_id,envelope,c.organizationId]);
}

/** R13 internal port: immutable entry only, never current balance or unrelated history. */
export async function receiptEntry(scope:TenantAccess,o:ObligationRow,id:string):Promise<PaymentEntryDto> {
  assertTenantAccess(scope,['payments.receipt.read']);
  return entryDto(await entry(scope,o,id));
}
