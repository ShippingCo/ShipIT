import type {CashbookRequestInput} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
const actions=['cashbook.request','cashbook.approve','cashbook.apply'] as const;
interface CodSource {remaining:string;received:string;reserved:string;freight:string;account_id:string;custodian_id:string;method:string}
/** Bind owned nested sources before reporting optimistic-version failures. */
export async function loadCodSource(scope:TenantAccess,input:CashbookRequestInput):Promise<CodSource|null>{
 if(!input.cod_allocation_id)return null;
 const source=(await scopedQuery<CodSource>(scope,[...actions],`SELECT p.remaining_paise::text remaining,r.amount_paise::text received,r.account_id,r.initial_custodian_id custodian_id,r.method,
 COALESCE((SELECT sum(x.reserved_paise) FROM shipit.cod_receipt_positions x WHERE x.organization_id=p.organization_id AND x.franchise_id=p.franchise_id AND x.receipt_id=p.receipt_id),0)::text reserved,
 COALESCE((SELECT sum(CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END) FROM shipit.money_receipt_allocations a WHERE a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.receipt_id=p.receipt_id),0)::text freight
 FROM shipit.cod_receipt_positions p JOIN shipit.money_receipts r ON r.organization_id=p.organization_id AND r.franchise_id=p.franchise_id AND r.id=p.receipt_id
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.allocation_id=$1`,[input.cod_allocation_id])).rows[0];
 if(!source)throw new HttpError('RESOURCE_NOT_FOUND');return source;
}
/** Remittance consumes seller liability, never freight allocation or expense. */
export async function validateCodSources(scope:TenantAccess,input:CashbookRequestInput,previous:CashbookRequestInput|null,source:CodSource|null){
 if(!input.cod_allocation_id)return;if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
 const replaced=previous?.cod_allocation_id===input.cod_allocation_id?BigInt(previous.amount_paise):0n;
 if(BigInt(input.amount_paise)>BigInt(source.remaining)+replaced)throw new HttpError('CASHBOOK_CONFLICT');
 if(input.kind==='cod_reservation_reversal'){
  const reversed=previous?.kind==='cod_reservation_reversal'?BigInt(previous.amount_paise):0n;
  if(BigInt(source.freight)+BigInt(source.reserved)+reversed-BigInt(input.amount_paise)>BigInt(source.received))throw new HttpError('ALLOCATION_CONFLICT');return;
 }
 const duplicate=(await scopedQuery(scope,[...actions],`SELECT r.id FROM shipit.cashbook_requests r
 JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.cod_allocation_id=$1 AND r.payment_reference=$2 AND r.id IS DISTINCT FROM $3::uuid
 AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests c JOIN shipit.cashbook_effects ce ON ce.organization_id=c.organization_id AND ce.franchise_id=c.franchise_id AND ce.request_id=c.id WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.correction_of=r.id) LIMIT 1`,[input.cod_allocation_id,input.payment_reference,input.correction_of??null])).rows[0];
 if(duplicate)throw new HttpError('CASHBOOK_CONFLICT');
}
