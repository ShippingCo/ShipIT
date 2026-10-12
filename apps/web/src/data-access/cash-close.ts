import {cashCloseExportColumns,reportLimits,type CashCloseInput,type CashCloseOperation,type CashCloseDetail,type CashCloseCountDto,type CashCloseCommandDto} from '@shippingco/shared';
import {array,choice,instant,integer,nullable,object,optional,protocol,text,uuid,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const time=(value:string)=>BigInt(Date.parse(value))*1000n+BigInt((value.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0').slice(3,6));
const money:Decoder<string>=v=>typeof v==='string'&&/^-?(0|[1-9][0-9]{0,39})$/.test(v)&&v!=='-0'?v:protocol();
const nonnegative:Decoder<string>=v=>{const r=money(v);return BigInt(r)>=0n?r:protocol();};
const day:Decoder<string>=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:protocol();
const denomination=object({denomination_paise:integer(1),quantity:integer()});
const denominations=array(denomination,100);
function validateDenominations(rows:ReturnType<typeof denominations>,amount:string){if(new Set(rows.map(r=>r.denomination_paise)).size!==rows.length||rows.length&&rows.reduce((n,r)=>n+BigInt(r.denomination_paise)*BigInt(r.quantity),0n)!==BigInt(amount))protocol();}
const openingParse=object({kind:choice('initial_count','approved_predecessor'),opening_at:instant,counted_paise:nonnegative,denominations,actor_id:uuid,reason:text,submission_id:nullable(uuid),count_id:nullable(uuid)});
export const closeOpening:Decoder<ReturnType<typeof openingParse>>=value=>{const r=openingParse(value);if((r.kind==='initial_count')!==(r.submission_id===null&&r.count_id===null)||r.kind==='approved_predecessor'&&(!r.submission_id||!r.count_id))protocol();validateDenominations(r.denominations,r.counted_paise);return r;};
export const closeControls=object({schema_version:choice(1),location_id:uuid,opening_at:instant,counted_at:instant,as_of:instant,inflow_paise:nonnegative,outflow_paise:nonnegative,known_position_paise:money,unknown_sources:integer(),coverage:choice('attributable','incomplete'),source_count:integer()});
const countParse=object({id:uuid,opening:closeOpening,counted_at:instant,counted_paise:nonnegative,denominations,reason:text,actor_id:uuid,as_of:instant,expected_paise:money,variance_paise:money,shortage_paise:nonnegative,excess_paise:nonnegative,controls:closeControls});
export const closeCount:Decoder<CashCloseCountDto>=value=>{
 const r=countParse(value),c=r.controls,expected=BigInt(r.opening.counted_paise)+BigInt(c.inflow_paise)-BigInt(c.outflow_paise),variance=BigInt(r.counted_paise)-expected;
 validateDenominations(r.denominations,r.counted_paise);
 if(expected!==BigInt(r.expected_paise)||variance!==BigInt(r.variance_paise)||BigInt(r.shortage_paise)!==(variance<0n?-variance:0n)||BigInt(r.excess_paise)!==(variance>0n?variance:0n)||r.as_of!==c.as_of||r.counted_at!==c.counted_at||r.opening.opening_at!==c.opening_at||time(r.counted_at)<=time(c.opening_at)||time(r.counted_at)>time(c.as_of)||c.source_count>reportLimits.rows||(c.coverage==='incomplete')!==(c.unknown_sources>0))protocol();return r;
};
const submission=object({id:uuid,count_id:uuid,previous_submission_id:nullable(uuid),actor_id:uuid,reason:text,recorded_at:instant});
const decision=object({id:uuid,submission_id:uuid,kind:choice('approve','reject'),mode:choice('independent','sole_admin_self'),actor_id:uuid,reason:text,recorded_at:instant});
const operation=choice('open','count','submit','decide','reopen'),state=choice('open','submitted','approved','rejected');
const commandParse=object({command_id:uuid,session_id:uuid,operation,version:integer(1),state,recorded_at:instant,count:optional(closeCount),submission:optional(submission),decision:optional(decision)});
export const closeCommand:Decoder<CashCloseCommandDto>=value=>{const r=commandParse(value);if((r.operation==='count')!==!!r.count||(r.operation==='submit')!==!!r.submission||(r.operation==='decide')!==!!r.decision||r.count&&r.count.id!==r.command_id||r.submission&&r.submission.id!==r.command_id||r.decision&&r.decision.id!==r.command_id)return protocol();return r;};
const sessionParse=object({id:uuid,location_id:uuid,location_revision_id:uuid,location_name:text,account_id:uuid,custodian_id:uuid,sequence:integer(1),day,predecessor_id:nullable(uuid),initial_opening:nullable(closeOpening),actor_id:uuid,recorded_at:instant,version:integer(1),state,count:nullable(closeCount),submission:nullable(submission),accepted_submission_id:nullable(uuid),accepted_count:nullable(closeCount),decision:nullable(decision)});
const detailParse=object({session:sessionParse,can_capture:choice(true,false),source_changed:choice(true,false),opening_changed:choice(true,false),current_controls:nullable(closeControls),review:object({admin:choice(true,false),eligible_admins:integer(),mode:nullable(choice('independent','sole_admin_self','different_admin_required'))}),dependencies:array(object({id:uuid,session_id:uuid,old_submission_id:uuid,new_submission_id:uuid,carry_changed:choice(true,false),recorded_at:instant})),dependencies_more:choice(true,false),prior_disputes:array(object({session_id:uuid,submission_id:uuid,counted_at:instant,variance_paise:money})),prior_disputes_more:choice(true,false)});
export const closeDetail:Decoder<CashCloseDetail>=value=>{
 const r=detailParse(value),s=r.session;
 if((s.sequence===1)!==(s.predecessor_id===null)||(s.predecessor_id===null)!==(s.initial_opening!==null)||(s.accepted_count===null)!==(s.accepted_submission_id===null)||s.count&&s.count.controls.location_id!==s.location_id||s.accepted_count&&s.accepted_count.controls.location_id!==s.location_id||s.decision&&s.decision.submission_id!==s.submission?.id||s.state==='submitted'&&(!s.count||s.submission?.count_id!==s.count.id)||s.state==='approved'&&(s.decision?.kind!=='approve'||s.accepted_submission_id!==s.submission?.id))protocol();
 if(s.decision&&s.submission&&s.decision.mode==='independent'&&s.decision.actor_id===s.submission.actor_id)protocol();return r;
};
const listRow=object({id:uuid,location_id:uuid,location_name:text,day,sequence:integer(1),version:integer(1),state,accepted_submission_id:nullable(uuid)});
const list=object({items:array(listRow),next_cursor:nullable(text)});
const source=object({source_kind:text,source_id:uuid,location_id:nullable(uuid),account_id:nullable(uuid),direction:choice('in','out'),amount_paise:nonnegative,occurred_at:instant,recorded_at:instant,request_id:nullable(uuid),correction_of:nullable(uuid),unknown_reason:nullable(text)});
const handover=object({id:uuid,source_location_id:uuid,target_location_id:uuid,remaining_paise:nonnegative});
const evidenceItem=(value:unknown)=>{const {kind}=object({kind:choice('source','pending_handover')})(value);return kind==='source'?object({kind:choice('source'),source})(value):object({kind:choice('pending_handover'),handover})(value);};
const evidence=object({capture_id:uuid,controls:closeControls,items:array(evidenceItem),next_cursor:nullable(text)});
const history=object({items:array((value:unknown)=>({...closeCommand(value),...object({actor_id:uuid,reason:text})(value)})),next_cursor:nullable(text)});
export const closeExport=object({id:uuid,definition:choice('cash_close_v1'),schema_version:choice(1),organization_id:uuid,franchise_id:uuid,as_of:instant,expires_at:instant,count:integer(),session_id:uuid,capture_id:uuid,opening_at:instant,opening_paise:nonnegative,counted_at:instant,counted_paise:nonnegative,expected_paise:money,variance_paise:money,coverage:choice('attributable','incomplete'),source_as_of:instant,submission_id:nullable(uuid),decision_kind:nullable(choice('approve','reject')),review_mode:nullable(choice('independent','sole_admin_self'))});
const download=object({snapshot:closeExport,columns:array(text,cashCloseExportColumns.length),csv:(value:unknown)=>typeof value==='string'&&new TextEncoder().encode(value).length<=reportLimits.bytes?value:protocol()});
const paths={open:'',count:'/counts',submit:'/submissions',decide:'/decisions',reopen:'/reopens'};
export function cashClose(api:ScopedApi){
 const base='/api/v1/cashbook/sessions',at=(id:string)=>base+'/'+uuid(id),actor=()=>api.scope.authority?.userId;
 const exportOwned=(value:unknown)=>{const r=closeExport(value);if(r.organization_id!==api.organization||r.franchise_id!==api.franchise||r.count>reportLimits.rows||Date.parse(r.expires_at)-Date.parse(r.as_of)!==reportLimits.lifetimeSeconds*1000||BigInt(r.counted_paise)-BigInt(r.expected_paise)!==BigInt(r.variance_paise))protocol();return r;};
 return {
  eligibility:(id:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/cashbook/locations/'+uuid(id)+'/closing-summary'),value=>{const r=object({location_id:uuid,latest_session_id:nullable(uuid),state:nullable(state),accepted_submission_id:nullable(uuid),opening:nullable(closeCount)})(value);return r.location_id===id?r:protocol();},signal),
  list:(cursor?:string,location?:string,signal?:AbortSignal)=>api.read(api.path(base)+((cursor||location)?'&'+new URLSearchParams({...cursor?{cursor}:{},...location?{location_id:uuid(location)}:{}}):''),value=>{const r=list(value);if(new Set(r.items.map(i=>i.id)).size!==r.items.length||location&&r.items.some(i=>i.location_id!==location))protocol();return r;},signal),
  detail:(id:string,signal?:AbortSignal)=>api.read(api.path(at(id)),value=>{const r=closeDetail(value);return r.session.id===id?r:protocol();},signal),
  command:(op:CashCloseOperation,id:string|null,input:CashCloseInput)=>api.intent('cash-close.'+op,api.path(op==='open'?base:at(id!)+paths[op]),input,'POST',op==='open'?undefined:input.expected_version),
  execute:(intent:CommandIntent)=>api.execute(intent,value=>{
   const r=closeCommand(value),sent=JSON.parse(intent.bodyJson) as CashCloseInput;
   if(intent.operation!=='cash-close.'+r.operation||intent.path!==api.path(r.operation==='open'?base:at(r.session_id)+paths[r.operation])||r.version!==sent.expected_version+1)protocol();
   if(r.count&&(!('counted_at' in sent)||r.count.actor_id!==actor()||Date.parse(r.count.counted_at)!==Date.parse(sent.counted_at)||r.count.counted_paise!==String(sent.counted_paise)||r.count.reason!==sent.reason))protocol();
   if(r.submission&&(!('count_id' in sent)||r.submission.actor_id!==actor()||r.submission.count_id!==sent.count_id||r.submission.reason!==sent.reason))protocol();
   if(r.decision&&(!('submission_id' in sent)||r.decision.actor_id!==actor()||r.decision.submission_id!==sent.submission_id||r.decision.kind!==sent.kind||r.decision.reason!==sent.reason||r.decision.mode==='sole_admin_self'&&!sent.sole_admin_acknowledged))protocol();return r;
  }),
  sources:(id:string,capture:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path(at(id)+'/sources')+'&'+new URLSearchParams({capture_id:uuid(capture),...cursor?{cursor}:{}}),value=>{
   const r=evidence(value);if(r.capture_id!==capture||r.items.some(row=>row.kind==='source'&&(row.source.location_id!==null&&row.source.location_id!==r.controls.location_id||time(row.source.recorded_at)>time(r.controls.as_of)||time(row.source.occurred_at)>time(r.controls.counted_at)||row.source.location_id!==null&&time(row.source.occurred_at)<=time(r.controls.opening_at))))protocol();return r;
  },signal),
  history:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path(at(id)+'/history')+(cursor?'&'+new URLSearchParams({cursor}):''),value=>{const r=history(value);if(r.items.some(i=>i.session_id!==id))protocol();return r;},signal),
  export:(id:string,capture:string)=>api.intent('cash-close.export',api.path(at(id)+'/exports'),{capture_id:uuid(capture)}),
  executeExport:(intent:CommandIntent)=>api.execute(intent,value=>{const r=exportOwned(value);if(intent.operation!=='cash-close.export'||intent.path!==api.path(at(r.session_id)+'/exports')||JSON.parse(intent.bodyJson).capture_id!==r.capture_id)protocol();return r;}),
  download:(id:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/cashbook/close-exports/'+uuid(id)+'/download'),value=>{const r=download(value);exportOwned(r.snapshot);if(r.snapshot.id!==id||r.columns.length!==cashCloseExportColumns.length||r.columns.some((c,n)=>c!==cashCloseExportColumns[n])||!r.csv.startsWith(cashCloseExportColumns.map(c=>'"'+c+'"').join(',')+'\r\n'))protocol();return r;},signal),
 };
}
export type CashCloseSource=ReturnType<typeof cashClose>;
