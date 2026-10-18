import { ageingBuckets,ageingMeasures,ageingStatuses,reportLimits,type AgeingPage,type AgeingExport,type AgeingFilter,type AgeingAmounts,type AgeingSummary } from '@shippingco/shared';
import { object,uuid,text,instant,integer,choice,array,nullable,optional,protocol,type Decoder } from './dto';
import {accountStatements} from './account-statements';
import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
const paise:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,24}$/.test(v)?v:protocol();
const amounts=object(Object.fromEntries(ageingMeasures.map(k=>[k,paise])) as Record<keyof AgeingAmounts,Decoder<string>>);
const buckets=object(Object.fromEntries(ageingBuckets.map(k=>[k,paise])) as Record<keyof AgeingSummary['buckets'],Decoder<string>>);
const summary={count:integer(),totals:amounts,buckets};
const row=object({account_id:optional(nullable(uuid)),account_revision_id:optional(nullable(uuid)),shipping_customer_id:optional(uuid),statement_id:optional(nullable(uuid)),id:uuid,customer_id:uuid,confirmed_at:instant,booking_version:integer(1),obligation_id:uuid,payment_version:integer(),financial_version:integer(),due_at:nullable(instant),age_days:nullable(integer(-4000000)),bucket:choice(...ageingBuckets),overdue:nullable(choice(true,false)),
  ...Object.fromEntries(ageingMeasures.map(k=>[k,paise])) as Record<keyof AgeingAmounts,Decoder<string>>,
  parcels:array(object({id:uuid,status:choice(...ageingStatuses)}),50),
  entries:array(object({receipt_id:optional(nullable(uuid)),allocation_id:optional(nullable(uuid)),id:uuid,kind:choice('collection','reversal'),amount:paise,version:integer(1),occurred_at:instant,reversal_of:nullable(uuid)}),50000),
  changes:array(object({id:uuid,kind:choice('discount','cancellation','correction','refund','refund_correction'),version:integer(1),reduction:paise,refund:paise,occurred_at:instant}),100)});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('to_pay_ageing_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,
  filter:object({overdue_only:optional(choice(true,false)),anchor:choice('booking','due'),status:nullable(choice(...ageingStatuses)),customer_id:nullable(uuid),balances:choice('outstanding','all')}),
  as_of:instant,expires_at:instant,...summary,customers:array(object({customer_id:uuid,...summary}),reportLimits.rows),due_date_source:choice('unavailable','frozen_account_terms'),advance_source:choice('unavailable','receipt_ledger'),unallocated_advance:optional(paise),advances:optional(array(object({customer_id:uuid,receipt_id:uuid,version:integer(1),received:paise,allocated:paise,cod_reserved:paise,returned:paise,unallocated:paise}),reportLimits.rows))});
export const ageingPage:Decoder<AgeingPage>=object({snapshot,rows:array(row,reportLimits.page),next_offset:nullable(integer())});
const csv:Decoder<string>=v=>typeof v==='string'&&v.length<=reportLimits.bytes?v:protocol();
const exported:Decoder<AgeingExport>=object({snapshot,columns:array(text,50),csv});
export function ageing(api:ScopedApi) {
  const path='/api/v1/reports/ageing';
  const check=(p:AgeingPage)=>{if(p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;};
  return {
    async statement(id:string,signal?:AbortSignal){const s=await accountStatements(api).read(id,signal);if(s.id!==id)protocol();return s;},
    intent(filter:AgeingFilter){return api.intent('ageing.capture',api.path(path),filter);},
    async execute(intent:CommandIntent){return check(await api.execute(intent,ageingPage,['$','Idempotency-Key']));},
    async page(id:string,offset=0,signal?:AbortSignal){const p=check(await api.read(api.path(path+'/'+uuid(id))+'&offset='+offset,ageingPage,signal));if(p.snapshot.id!==id)protocol();return p;},
    async export(id:string){const p=await api.read(api.path(path+'/'+uuid(id)+'/export'),exported);if(p.snapshot.id!==id||p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;},
  };
}
export type AgeingSource=ReturnType<typeof ageing>;
