import type {ParcelCustodyCommandDto,ParcelCustodyReportDto,ParcelCustodySnapshotDto,ParcelHandoverDto,ParcelHandoverInput,ParcelReturnInput,ParcelCustodyGrantInput,ParcelReleaseInput,ParcelCustodyWorklistDto,ParcelCustodyTransferPage,ParcelCustodyOutgoingManifestPage} from '@shippingco/shared';
import {array,choice,instant,integer,nullable,object,protocol,text,uuid,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const unique=(ids:readonly string[])=>new Set(ids).size===ids.length;
const item=object({item_id:uuid,parcel_id:uuid,outcome:choice('delivered','returned','held','reassigned','pending'),
 origin_receipt_id:nullable(uuid),current_receipt_id:nullable(uuid),proof_id:nullable(uuid),failure_ids:array(uuid,2)});
const totals=object({total:integer(),delivered:integer(),returned:integer(),held:integer(),reassigned:integer(),pending:integer(),failed:integer()});
const reportShape={manifest_id:uuid,agent_id:uuid,as_of:instant,totals,failure_count:integer()};
export const custodyReport:Decoder<ParcelCustodyReportDto>=value=>{
 const r=object({...reportShape,items:array(item,50)})(value),counts={delivered:0,returned:0,held:0,reassigned:0,pending:0,failed:0},failures=new Set<string>();
 if(!unique(r.items.flatMap(i=>i.origin_receipt_id?[i.origin_receipt_id]:[]))||!unique(r.items.flatMap(i=>i.current_receipt_id?[i.current_receipt_id]:[]))||!unique(r.items.flatMap(i=>i.proof_id?[i.proof_id]:[]))||!unique(r.items.map(i=>i.item_id))||!unique(r.items.map(i=>i.parcel_id))||r.items.length!==r.totals.total)return protocol();
 for(const i of r.items){
  if(!unique(i.failure_ids)||(i.outcome==='pending'?(i.origin_receipt_id!==null||i.current_receipt_id!==null||i.proof_id!==null||i.failure_ids.length!==0):
   i.origin_receipt_id===null||i.current_receipt_id===null)||(i.outcome==='delivered')!==(i.proof_id!==null))return protocol();
  counts[i.outcome]++;if(i.failure_ids.length)counts.failed++;for(const id of i.failure_ids){if(failures.has(id))return protocol();failures.add(id);}
 }
 if(Object.entries(counts).some(([k,v])=>r.totals[k as keyof typeof counts]!==v)||r.failure_count!==failures.size)return protocol();
 return r;
};
export const custodySnapshot:Decoder<ParcelCustodySnapshotDto>=value=>{
 const r=object({id:uuid,definition:choice('custody_manifest_v1'),organization_id:uuid,franchise_id:uuid,as_of:instant,expires_at:instant,count:integer(),
 report:object(reportShape),items:array(item,50)})(value);
 custodyReport({...r.report,items:r.items});
 if(r.count!==r.items.length||r.as_of!==r.report.as_of||Date.parse(r.expires_at)-Date.parse(r.as_of)!==86400000)return protocol();
 return r;
};
export const custodyManifest:Decoder<ParcelHandoverDto>=value=>{
 const r=object({id:uuid,agent_id:uuid,recorded_at:instant,state:choice('prepared','acknowledged','cancelled'),version:choice(1,2),
  items:array(object({id:uuid,parcel_id:uuid,expected_parcel_version:integer(1),previous_receipt_id:nullable(uuid),receipt_id:nullable(uuid)}),50)})(value);
 if(!r.items.length||!unique(r.items.map(i=>i.id))||!unique(r.items.map(i=>i.parcel_id))||r.version!==(r.state==='prepared'?1:2)||
  (r.state==='acknowledged'?!r.items.every(i=>i.receipt_id!==null):r.items.some(i=>i.receipt_id!==null)))return protocol();return r;
};
export const custodyWorklist:Decoder<ParcelCustodyWorklistDto>=value=>{
 const r=object({as_of:instant,next_cursor:nullable(uuid),items:array(object({parcel_id:uuid,docket:text,parcel_version:integer(1),status:choice('booked','checked_in','dispatched','in_transit','out_for_delivery','delivered','failed_attempt','rto'),
 assigned_agent_id:nullable(uuid),attempt_id:nullable(uuid),receipt_id:nullable(uuid),physical_custody:choice('unknown','agent','office','recipient'),proof_id:nullable(uuid)}),50)})(value);
 if(!unique(r.items.map(i=>i.parcel_id))||(r.next_cursor!==null&&(r.items.length!==50||r.next_cursor!==r.items.at(-1)!.parcel_id))||
  r.items.some(i=>(i.physical_custody==='unknown')!==(i.receipt_id===null)||(i.physical_custody==='recipient')!==(i.proof_id!==null)))return protocol();return r;
};
export const custodyTransfers:Decoder<ParcelCustodyTransferPage>=value=>{
 const r=object({next_cursor:nullable(uuid),items:array(object({id:uuid,parcel_id:uuid,source_receipt_id:uuid,agent_id:uuid,destination_kind:choice('agent','office'),destination_agent_id:nullable(uuid),parcel_version:integer(1),assigned_agent_id:nullable(uuid),can_prepare:choice(true,false),instruction_id:nullable(uuid),office_release_id:nullable(uuid)}),50)})(value);
 if(!unique(r.items.map(i=>i.id))||(r.next_cursor!==null&&(r.items.length!==50||r.next_cursor!==r.items.at(-1)!.id))||r.items.some(i=>(i.destination_kind==='office')!==(i.destination_agent_id===null)||i.destination_agent_id===i.agent_id||i.can_prepare&&(i.destination_kind!=='agent'||i.assigned_agent_id!==i.destination_agent_id&&i.instruction_id===null)||i.destination_kind==='agent'&&i.office_release_id!==null))return protocol();return r;
};
const commandResult:Decoder<ParcelCustodyCommandDto>=value=>{const r=object({command_id:uuid,resource_id:uuid,receipt_ids:array(uuid,50),recorded_at:instant})(value);if(!unique(r.receipt_ids))return protocol();return r;};
export type CustodyCommand=
 |{kind:'authorize';body:{parcel_id:string;agent_id:string;expected_parcel_version:number}}
 |{kind:'prepare';body:ParcelHandoverInput}
 |{kind:'acknowledge'|'cancel';id:string;body:{expected_version:1}}
 |{kind:'return';body:ParcelReturnInput}
 |{kind:'grant';body:ParcelCustodyGrantInput}
 |{kind:'revoke_grant';id:string;body:{expected_version:1}}
 |{kind:'release';body:ParcelReleaseInput};
const operations=['authorize','prepare','acknowledge','cancel','return','grant','revoke_grant','release'] as const;
export function custody(api:ScopedApi){
 const at=(suffix:string)=>api.path('/api/v1/custody'+suffix),cursor=(value?:string)=>value?'&cursor='+uuid(value):'';
 const snapshot=(value:unknown)=>{const r=custodySnapshot(value);if(r.organization_id!==api.organization||r.franchise_id!==api.franchise)return protocol();return r;};
 return {
  worklist:(after?:string,signal?:AbortSignal)=>api.read(at('/worklist')+cursor(after),custodyWorklist,signal),
  manifests:(after?:string,signal?:AbortSignal)=>api.read(at('/manifests')+cursor(after),value=>{
   const r=object({next_cursor:nullable(uuid),items:array(object({id:uuid,agent_id:uuid,recorded_at:instant,item_count:integer(1),state:choice('prepared','acknowledged','cancelled')}),50)})(value);
   if(!unique(r.items.map(i=>i.id))||r.items.some(i=>i.item_count>50)||(r.next_cursor!==null&&(r.items.length!==50||r.next_cursor!==r.items.at(-1)!.id)))return protocol();return r;
  },signal),
  agents:(after?:string,signal?:AbortSignal)=>api.read(at('/eligible-agents')+cursor(after),value=>{
   const r=object({agents:array(object({id:uuid}),100),next_cursor:nullable(uuid)})(value);
   if(!unique(r.agents.map(a=>a.id))||(r.next_cursor!==null&&(r.agents.length!==100||r.next_cursor!==r.agents.at(-1)!.id)))return protocol();return r;
  },signal),
  manifest:(id:string,signal?:AbortSignal)=>api.read(at('/manifests/'+uuid(id)),value=>{const r=custodyManifest(value);if(r.id!==id)return protocol();return r;},signal),
  report:(id:string,signal?:AbortSignal)=>api.read(at('/manifests/'+uuid(id)+'/report'),value=>{const r=custodyReport(value);if(r.manifest_id!==id)return protocol();return r;},signal),
  transfers:(after?:string,signal?:AbortSignal)=>api.read(at('/transfer-grants')+cursor(after),custodyTransfers,signal),
  outgoingManifests:(id:string,after?:string,signal?:AbortSignal)=>api.read(at('/transfer-grants/'+uuid(id)+'/manifests')+cursor(after),value=>{
   const r:ParcelCustodyOutgoingManifestPage=object({grant_id:uuid,next_cursor:nullable(uuid),items:array(object({id:uuid,agent_id:uuid,released:choice(true,false)}),50)})(value);
   if(r.grant_id!==id||!unique(r.items.map(i=>i.id))||(r.next_cursor!==null&&(r.items.length!==50||r.next_cursor!==r.items.at(-1)!.id)))return protocol();return r;
  },signal),
  intent:(command:CustodyCommand)=>{
   const path=command.kind==='authorize'?'/assignment-instructions':command.kind==='prepare'?'/manifests':command.kind==='return'?'/returns':
    command.kind==='grant'?'/grants':command.kind==='release'?'/releases':command.kind==='revoke_grant'?'/grants/'+uuid(command.id)+'/revoke':'/manifests/'+uuid(command.id)+'/'+command.kind;
   return api.intent('custody.'+command.kind,at(path),command.body);
  },
  execute:(intent:CommandIntent)=>{
   const kind=operations.find(k=>'custody.'+k===intent.operation);if(!kind)return protocol();
   return api.execute(intent,value=>{const r=commandResult(value);
    const bound=kind==='acknowledge'||kind==='cancel'?'/manifests/'+r.resource_id+'/'+kind:kind==='revoke_grant'?'/grants/'+r.resource_id+'/revoke':null;
    if(bound&&intent.path!==at(bound)||kind==='acknowledge'&&r.receipt_ids.length===0||kind==='return'&&r.receipt_ids.length>1||kind!=='acknowledge'&&kind!=='return'&&r.receipt_ids.length!==0)return protocol();
    return r;
   },['$','expected_version','expected_parcel_version']);
  },
  capture:(id:string)=>api.intent('custody.capture',at('/manifests/'+uuid(id)+'/exports'),{}),
  executeCapture:(intent:CommandIntent)=>{if(intent.operation!=='custody.capture')return protocol();return api.execute(intent,value=>{
   const r=snapshot(value);if(intent.path!==at('/manifests/'+r.report.manifest_id+'/exports'))return protocol();return r;
  });},
  snapshot:(id:string,signal?:AbortSignal)=>api.read(at('/exports/'+uuid(id)),value=>{const r=snapshot(value);if(r.id!==id)return protocol();return r;},signal),
  export:(id:string,signal?:AbortSignal)=>api.read(at('/exports/'+uuid(id)+'/export'),value=>{
   const r=object({snapshot,csv:(v:unknown)=>typeof v==='string'&&v.length<=8388608?v:protocol()})(value);if(r.snapshot.id!==id)return protocol();return r;
  },signal),
 };
}
export type CustodySource=ReturnType<typeof custody>;
