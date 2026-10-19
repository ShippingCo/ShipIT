import {createHash} from 'node:crypto';
import {accountantColumns,reportLimits,type AccountantRow,type AccountantSnapshot,type AccountantFile,type AccountantControl} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {csvCell} from './rules.ts';
import {taxRate} from './sales-repository.ts';
const references=new Set(['external_reference','transfer_ref','payment_reference','approval_ref']);
export function accountantRows(rows:Omit<AccountantRow,'id'>[],includeReferences:boolean):AccountantRow[] {
 const result=rows.map(row=>{
  const fields={...row.fields};if(!includeReferences)for(const key of references)if(key in fields)fields[key]=null;
  // Identity is deliberately independent of capture, optional private columns and changed amounts.
  const identity=[row.family,fields.franchise_id,fields.source_id,fields.booking_id??'',fields.ordinal??'',fields.location_id??'',fields.direction??''].join(':');
  return {...row,fields,id:createHash('sha256').update(identity).digest('hex')};
 });
 if(new Set(result.map(r=>r.id)).size!==result.length)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 return result.sort((a,b)=>a.family.localeCompare(b.family)||a.id.localeCompare(b.id));
}
export function reconcileControls(rows:readonly AccountantRow[],controls:readonly Omit<AccountantControl,'export_paise'|'difference_paise'>[]):AccountantControl[] {
 return controls.map(c=>{const actual=rows.filter(r=>r.family===c.family&&r.basis===c.basis).reduce((sum,r)=>sum+BigInt(r.fields[c.column]??'0'),0n);
  const difference=actual-BigInt(c.source_paise);if(difference!==0n)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return {...c,export_paise:String(actual),difference_paise:String(difference)};
 });
}
// Known integer money fields cannot execute formulas; preserve signed machine-readable paise.
export const accountantCsv=(columns:readonly string[],rows:readonly (readonly string[])[])=>[columns.map(csvCell).join(','),...rows.map(row=>row.map((cell,i)=>columns[i]?.endsWith('_paise')&&/^-?\d+$/.test(cell)?'"'+cell+'"':csvCell(cell)).join(','))].join('\r\n')+'\r\n';
/** Allowlisted reconciliation lineage, excluding raw imports, reasons, names and bank identifiers. */
export function reconciliationEvidence(evidence:Record<string,unknown>):Record<string,unknown> {
 const keys=new Set(['transaction_id','import_id','row_number','classification_version','matches','id','method','amount_paise','batch_id','reviewed_at','sources','source_id','source_version','is_fee','source_kind','version','recorded_at','expected_date','receipts','fees','case_id','state','kind','unknown_reason','account_scope']);
 const project=(v:unknown):unknown=>Array.isArray(v)?v.map(project):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>keys.has(k)).map(([k,value])=>[k,k.endsWith('_paise')&&typeof value==='number'?String(value):project(value)])):v;
 return project(evidence) as Record<string,unknown>;
}

export function accountantFiles(snapshot:AccountantSnapshot,rows:readonly AccountantRow[]):AccountantFile[] {
 const files:AccountantFile[]=[];
 const common=['schema_version','mapping_version','capture_id','as_of','organization_id','event_line_id','meaning','basis'];
 const families=[...new Set([...Object.keys(accountantColumns),...rows.map(r=>r.family)])].sort();
 const dictionary:string[][]=[];
 for(const family of families){
  const selected=rows.filter(r=>r.family===family),declared=accountantColumns[family as keyof typeof accountantColumns];
  if(!declared)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  const columns=declared;
  files.push({name:family+'.csv',csv:accountantCsv([...common,...columns],selected.map(r=>['1',snapshot.mapping_version,snapshot.id,snapshot.as_of,snapshot.organization_id,r.id,r.meaning,r.basis,...columns.map(c=>r.fields[c]??'unknown')]))});
  for(const column of [...common,...columns])dictionary.push([family+'.csv',column,column.endsWith('_paise')?'signed integer INR paise':column.endsWith('_id')?'opaque text; retain leading zeroes':'text','unknown = absent or unavailable; never zero',references.has(column)?'only when include_references=true':'selected source evidence']);
 }
 const gst=new Map<string,{basis:string;kind:string;rate:string;treatment:string;jurisdiction:string;policy:string;taxable:bigint;nonTaxable:bigint;cgst:bigint;sgst:bigint;igst:bigint;rounding:bigint;gross:bigint}>();
 for(const row of rows.filter(r=>r.family==='sales'||r.family==='adjustments')){
  const source=row.family==='sales'?row:rows.find(r=>r.family==='sales'&&r.fields.source_id===row.fields.booking_id);
  const rate=source?.fields.tax_components?taxRate(JSON.parse(source.fields.tax_components)):'unknown';
  const f=row.fields,original=row.family==='sales',key=JSON.stringify([row.basis,row.family,rate,source?.fields.tax_policy_id,source?.fields.tax_treatment,source?.fields.tax_jurisdiction]);
  const g=gst.get(key)??{basis:row.basis,kind:row.family,rate,treatment:source?.fields.tax_treatment??'unknown',jurisdiction:source?.fields.tax_jurisdiction??'unknown',policy:source?.fields.tax_policy_id??'unknown',taxable:0n,nonTaxable:0n,cgst:0n,sgst:0n,igst:0n,rounding:0n,gross:0n};
  const value=(key:string)=>BigInt(f[key+(original?'_paise':'_reduction_paise')]??0);
  g.taxable+=value('taxable');g.nonTaxable+=value('pre_tax')-value('taxable');g.cgst+=value('cgst');g.sgst+=value('sgst');g.igst+=value('igst');g.rounding+=value('rounding');g.gross+=value('gross');gst.set(key,g);
 }
 files.push({name:'gst_summary.csv',csv:accountantCsv(['basis','source_family','meaning','rate','tax_treatment','jurisdiction','policy_id','taxable_paise','non_taxable_paise','cgst_paise','sgst_paise','igst_paise','rounding_paise','gross_paise'],[...gst.values()].map(g=>[g.basis,g.kind,'reference_summary:not_extra_sale',g.rate,g.treatment,g.jurisdiction,g.policy,...[g.taxable,g.nonTaxable,g.cgst,g.sgst,g.igst,g.rounding,g.gross].map(String)]))});
 files.push({name:'controls.csv',csv:accountantCsv(['family','basis','column','source_paise','export_paise','difference_paise'],snapshot.controls.map(c=>[c.family,c.basis,c.column,c.source_paise,c.export_paise,c.difference_paise]))});
 
 files.push({name:'manifest.csv',csv:accountantCsv(['key','value'],Object.entries({schema_version:'1',mapping_version:snapshot.mapping_version,capture_id:snapshot.id,organization_id:snapshot.organization_id,franchise_ids:snapshot.filter.franchise_ids.join(';'),from_day:snapshot.filter.from_day,to_day:snapshot.filter.to_day,timezone:snapshot.timezone,as_of:snapshot.as_of,expires_at:snapshot.expires_at,mode:'complete snapshot; not delta',basis:'period position updated through capture; opening rows precede from_day; period rows precede next-day Kolkata midnight',identity:'deduplicate by organization/franchise/family/source_id/line; compare source_version; never deduplicate by capture_id',corrections:'append-only signed effects; refund correction is not a new transfer; statements and allocations are reference-only',qualification:'Generic evidence only. No qualified external accounting format or statutory tax-document claim.',reconciliation:snapshot.reconciliation_state,include_references:String(snapshot.filter.include_references),currency:'INR',money:'exact integer paise; reductions positive; correction effects signed',limits:'31 days; 5000 combined rows; 8 MiB combined files and saved payload; 24 hours; 20 active captures',unknown:'unknown never means zero; absent source evidence must be investigated'}))});
 for(const file of files.filter(f=>!families.some(family=>f.name===family+'.csv'))){for(const column of file.csv.split('\r\n')[0]!.split(',').map(c=>c.slice(1,-1)))dictionary.push([file.name,column,column.endsWith('_paise')?'signed integer INR paise':'text','unknown = absent or unavailable; never zero','derived from selected source evidence']);}
 files.push({name:'dictionary.csv',csv:accountantCsv(['file','column','type_unit','unknown','privacy'],dictionary)});
 if(files.reduce((n,f)=>n+512+Math.ceil(Buffer.byteLength(f.csv)/512)*512,1024)>reportLimits.bytes||Buffer.byteLength(JSON.stringify(files))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 return files;
}
