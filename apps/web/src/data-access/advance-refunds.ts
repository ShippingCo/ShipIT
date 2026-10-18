import type {AdvanceRefundCommand,AdvanceRefundOperation} from '@shippingco/shared';
import {object,uuid,integer,choice,instant,array,nullable,protocol} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
function refund(value:unknown):AdvanceRefundCommand{
 const r=object({id:uuid,request_id:uuid,receipt_id:uuid,version:integer(1),operation:choice('request','approve','reject','return'),actor_id:uuid,recorded_at:instant,amount_paise:integer(1),input:(v:unknown)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return protocol();return v as Record<string,unknown>;
 }})(value);
 const fields=r.operation==='request'?['expected_receipt_version','amount_paise','reason']:r.operation==='return'?['expected_version','source_location_id','source_revision_id','method','occurred_at','transfer_ref','returned_to_ref','reason']:['expected_version','reason'];
 if(Object.keys(r.input).length!==fields.length||fields.some(f=>!Object.hasOwn(r.input,f))||typeof r.input.reason!=='string'||r.input.reason.length<3||r.input.reason.length>500)return protocol();
 if(r.operation==='request'){if(r.version!==1||r.request_id!==r.id||r.input.amount_paise!==r.amount_paise)return protocol();integer(1)(r.input.expected_receipt_version);}
 else if(r.operation==='return'){if(r.version!==3||r.input.expected_version!==2)return protocol();uuid(r.input.source_location_id);uuid(r.input.source_revision_id);instant(r.input.occurred_at);choice('cash','upi','card','bank_transfer','other')(r.input.method);for(const key of ['transfer_ref','returned_to_ref'])if(typeof r.input[key]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(String(r.input[key])))return protocol();}
 else if(r.version!==2||r.input.expected_version!==1)return protocol();
 return r;
}
export function advanceRefunds(api:ScopedApi,receipt:string){const path='/api/v1/money-receipts/'+uuid(receipt)+'/advance-refunds';return {
 list:(cursor?:string,signal?:AbortSignal)=>api.read(api.path(path)+(cursor?'&cursor='+uuid(cursor):''),v=>{const p=object({items:array(refund,100),next_cursor:nullable(uuid)})(v);if(p.items.some(c=>c.receipt_id!==receipt)||new Set(p.items.map(c=>c.id)).size!==p.items.length)return protocol();return p;},signal),
 intent:(operation:AdvanceRefundOperation,request:string|null,input:Record<string,unknown>)=>api.intent('api.v1.money_receipts.refund.'+operation,api.path(path+(operation==='request'?'':'/'+uuid(request)+'/'+operation)),input),
 execute:(intent:CommandIntent)=>api.execute(intent,v=>{const r=refund(v),sent=JSON.parse(intent.bodyJson) as Record<string,unknown>;
  if(r.receipt_id!==receipt||intent.operation!=='api.v1.money_receipts.refund.'+r.operation||r.operation!=='request'&&!intent.path.includes('/'+r.request_id+'/')||Object.keys(sent).length!==Object.keys(r.input).length||Object.entries(sent).some(([k,v])=>r.input[k]!==v))return protocol();return r;
 },['expected_receipt_version','amount_paise','reason','expected_version','source_location_id','source_revision_id','method','occurred_at','transfer_ref','returned_to_ref'])
};}
