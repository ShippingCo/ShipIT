import {accountantColumns,type AccountantPage,type AccountantExport,type AccountantRow,type AccountantFilter} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const evidenceText:Decoder<string>=v=>typeof v==='string'&&v.length<=8*1024*1024?v:protocol();
const money:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,30}$/.test(v)?v:protocol();
const control=object({family:text,basis:text,column:text,source_paise:money,export_paise:money,difference_paise:money});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('accountant_register_v1'),mapping_version:choice('generic_csv_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,filter:object({from_day:text,to_day:text,sort:choice('confirmed_asc','confirmed_desc'),franchise_ids:array(uuid,50),include_references:choice(true,false),format:choice('generic_csv_v1')}),as_of:instant,expires_at:instant,count:integer(),controls:array(control,30000),qualification:choice('generic_only'),reconciliation_state:text});
const row:Decoder<AccountantRow>=v=>{
 const base=object({id:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:protocol(),family:text,meaning:text,basis:choice('opening','period')})(v),keys=accountantColumns[base.family as keyof typeof accountantColumns];
 if(!keys||!v||typeof v!=='object'||!('fields' in v))return protocol();
 return {...base,fields:object(Object.fromEntries(keys.map(k=>[k,nullable(k.endsWith('_paise')?money:['evidence','tax_components'].includes(k)?evidenceText:text)])))(v.fields)};
};
const decodedPage=object({snapshot,rows:array(row,100),next_offset:nullable(integer())});
export const accountantPage:Decoder<AccountantPage>=v=>{const p=decodedPage(v);if(p.snapshot.count>5000||!p.snapshot.filter.franchise_ids.includes(p.snapshot.franchise_id)||p.rows.some(r=>!p.snapshot.filter.franchise_ids.includes(r.fields.franchise_id!))||new Set(p.rows.map(r=>r.id)).size!==p.rows.length||p.next_offset!==null&&(p.next_offset%100!==0||p.next_offset>=p.snapshot.count))return protocol();return p;};
const exported:Decoder<AccountantExport>=object({snapshot,files:array(object({name:v=>typeof v==='string'&&/^[a-z_]+\.csv$/.test(v)?v:protocol(),csv:v=>typeof v==='string'&&v.length<=8*1024*1024?v:protocol()}),50)});
export function accountant(api:ScopedApi) {
 const base='/api/v1/reports/accountant',owned=<T extends {snapshot:AccountantPage['snapshot']}>(r:T,id?:string)=>{if(r.snapshot.organization_id!==api.organization||r.snapshot.franchise_id!==api.franchise||id!==undefined&&r.snapshot.id!==id)protocol();return r;};
 return {franchise:api.franchise,
  intent:(filter:AccountantFilter)=>api.intent('accountant.capture',api.path(base),{from_day:filter.from_day,to_day:filter.to_day,franchise_ids:filter.franchise_ids,include_references:filter.include_references,format:filter.format}),
  execute:async(intent:CommandIntent)=>owned(await api.execute(intent,accountantPage,['$','Idempotency-Key'])),
  page:async(id:string,offset=0,family?:string,rowId?:string,signal?:AbortSignal,control?:number)=>owned(await api.read(api.path(base+'/'+uuid(id))+'&'+new URLSearchParams({offset:String(offset),...(family?{family}:{}),...(rowId?{row:rowId}:{}),...(control===undefined?{}:{control:String(control)})}),accountantPage,signal),id),
  export:async(id:string)=>owned(await api.read(api.path(base+'/'+uuid(id)+'/export'),exported),id),
 };
}
export type AccountantSource=ReturnType<typeof accountant>;
