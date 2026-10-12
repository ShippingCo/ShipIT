import {shipmentCostCategories,type ShipmentCostInput,type ContributionFilter} from '@shippingco/shared';
import {object,uuid,integer} from '../pricing/validation.ts';
import {FieldValidationError} from '../../plugins/errors.ts';
import {salesFilter} from '../reports/sales-service.ts';
import {decodeCsv,CsvError} from '../carriers/csv.ts';
export const fail=():never=>{throw new FieldValidationError('$','INVALID_FORMAT');};
export function instant(v:unknown):string {
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v)||v<'2000'||v>'9999')return fail();
 const base=v.slice(0,19),date=new Date(base+'Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==base)return fail();
 return base+'.'+(v.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0')+'Z';
}
export function text(v:unknown,max=128):string {if(typeof v!=='string'||!v.trim()||v.length>max||[...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return fail();return v.trim();}
const nullableId=(v:unknown)=>v==null?null:uuid(v,'$');
const identity=(v:unknown)=>v==null?null:text(text(v).normalize('NFKC').toUpperCase());
export function input(value:unknown):ShipmentCostInput {
 const b=object(value,['source_id','expected_version','category','state','amount_paise','effective_at','reason','reference','supplier','document','line','expense_id','rate_import_id','rate_booking_id','allocations']);
 if(!shipmentCostCategories.includes(b.category as never)||!['actual','estimated','not_applicable'].includes(String(b.state)))return fail();
 const source_id=nullableId(b.source_id),expected_version=integer(b.expected_version,'expected_version',0,2147483645);
 if((source_id===null)!==(expected_version===0))return fail();
 const supplier=identity(b.supplier),document=identity(b.document),line=identity(b.line),expense_id=nullableId(b.expense_id),rate_import_id=nullableId(b.rate_import_id),rate_booking_id=nullableId(b.rate_booking_id);
 if([supplier,document,line].filter(Boolean).length%3!==0||(rate_import_id===null)!==(rate_booking_id===null)||expense_id&&rate_import_id)return fail();
 const state=b.state as ShipmentCostInput['state'];
 if(state==='not_applicable'&&(supplier||expense_id||rate_import_id)||state!=='not_applicable'&&!supplier&&!expense_id&&!rate_import_id)return fail();
 if(expense_id&&state!=='actual'||rate_import_id&&(state!=='estimated'||b.category!=='courier'))return fail();
 if(!Array.isArray(b.allocations)||!b.allocations.length||b.allocations.length>100)return fail();
 const allocations=b.allocations.map(v=>{const a=object(v,['booking_id','parcel_id','amount_paise']);return {booking_id:uuid(a.booking_id,'$'),parcel_id:nullableId(a.parcel_id),amount_paise:integer(a.amount_paise,'amount_paise')};}).sort((a,b)=>(a.booking_id+(a.parcel_id??'')).localeCompare(b.booking_id+(b.parcel_id??'')));
 const amount_paise=integer(b.amount_paise,'amount_paise'),zeroNative=expense_id!==null&&state==='actual'&&amount_paise===0;
 if(new Set(allocations.map(a=>a.booking_id+':'+a.parcel_id)).size!==allocations.length||allocations.some(a=>(a.amount_paise===0)!==(state==='not_applicable'||zeroNative)&&!rate_import_id))return fail();
 if(!rate_import_id&&((amount_paise===0)!==(state==='not_applicable'||zeroNative)||allocations.reduce((n,a)=>n+BigInt(a.amount_paise),0n)>BigInt(amount_paise)))return fail();
 if(rate_import_id&&(allocations.length!==1||allocations[0]!.booking_id!==rate_booking_id||allocations[0]!.parcel_id!==null))return fail();
 const reason=text(b.reason,256);if(reason.length<3)return fail();
 return {source_id,expected_version,category:b.category as ShipmentCostInput['category'],state,amount_paise,effective_at:instant(b.effective_at),reason,reference:text(b.reference),supplier,document,line,expense_id,rate_import_id,rate_booking_id,allocations};
}
export function upload(value:unknown):ShipmentCostInput[]{
 const b=object(value,['rows','format','content_base64']);
 if(b.rows!==undefined){if(b.format!==undefined||b.content_base64!==undefined||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)return fail();return b.rows.map(input);}
 if(b.format!=='shipit_cost_csv_v1')return fail();
 const csv=decodeCsv(b.content_base64),headers=['category','state','amount_paise','effective_at','reason','reference','supplier','document','line','booking_id','parcel_id'];
 if(csv.headers.join(',')!==headers.join(',')||csv.records.length>100)throw new CsvError('COST_HEADERS');
 return csv.records.map((row,n)=>{if(row.length!==headers.length)throw new CsvError('COLUMN_COUNT',n+2);const r=Object.fromEntries(headers.map((k,i)=>[k,row[i]!]));if(!/^(0|[1-9][0-9]{0,15})$/.test(r.amount_paise!))throw new CsvError('INVALID_AMOUNT',n+2);const {booking_id,parcel_id,...fields}=r;return input({...fields,source_id:null,expected_version:0,supplier:r.supplier||null,document:r.document||null,line:r.line||null,amount_paise:Number(r.amount_paise),allocations:[{booking_id,parcel_id:parcel_id||null,amount_paise:Number(r.amount_paise)}]});});
}
export function filter(value:unknown,franchise:string):ContributionFilter {
 const b=object(value,['from_day','to_day','sort','franchise_ids','effective_at','recorded_at']);const base=salesFilter({from_day:b.from_day,to_day:b.to_day,sort:b.sort,franchise_ids:b.franchise_ids},franchise);
 return {from_day:base.from_day,to_day:base.to_day,sort:base.sort,franchise_ids:base.franchise_ids,effective_at:b.effective_at==null?null:instant(b.effective_at),recorded_at:b.recorded_at==null?null:instant(b.recorded_at)};
}
