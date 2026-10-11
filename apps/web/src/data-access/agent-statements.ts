import {reportLimits,statementExportColumns} from '@shippingco/shared';
import {statementDay as day,statementEvidence,statementMoney} from './agent-statement-evidence';
import {array,choice,instant,integer,nullable,object,protocol,text,uuid,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const reason:Decoder<string>=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=500?value.trim():protocol();
const status=choice('pending','approved','rejected','superseded');
const headerShape={id:uuid,capture_id:uuid,agent_id:uuid,day,revision:integer(1),previous_submission_id:nullable(uuid),actor_id:uuid,reason:text,recorded_at:instant};
const parseHeader=object(headerShape);
export const statementHeader:Decoder<ReturnType<typeof parseHeader>>=value=>{
 const r=parseHeader(value);if((r.revision===1)!==(r.previous_submission_id===null)||r.previous_submission_id===r.id)return protocol();return r;
};
export const statementReview=object({id:uuid,submission_id:uuid,kind:choice('approve','reject'),expected_version:integer(1),actor_id:uuid,reason:text,recorded_at:instant});
const listRow=object({...headerShape,status});
const list=object({items:array(listRow,100),as_of:instant,next_cursor:nullable(text)});
const submitInput=object({capture_id:uuid,previous_submission_id:nullable(uuid),expected_version:integer(),reason});
const reviewInput=object({kind:choice('approve','reject'),expected_version:integer(1),reason});
const captureInput=object({agent_id:uuid,day,counted_at:instant,counted_paise:integer(),reason});
const captureShape={id:uuid,agent_id:uuid,day,counted_at:instant,counted_paise:statementMoney,actor_id:uuid,reason:text,recorded_at:instant,source_snapshot:statementEvidence};
const captureParse=object(captureShape);
export const statementCapture:Decoder<ReturnType<typeof captureParse>>=value=>{
 const r=captureParse(value),s=r.source_snapshot;if(r.agent_id!==s.cash.agent_id||r.day!==s.cash.day||r.counted_at!==s.cash.counted_at||r.recorded_at!==s.cash.as_of||r.counted_paise!==s.totals.counted_paise)return protocol();return r;
};
const detailParse=object({...headerShape,counted_at:instant,counted_paise:statementMoney,capture_recorded_at:instant,source_snapshot:statementEvidence,decision:nullable(statementReview),status});
export const statementDetail:Decoder<ReturnType<typeof detailParse>>=value=>{
 const r=detailParse(value),s=r.source_snapshot;statementHeader(r);
 if(r.agent_id!==s.cash.agent_id||r.day!==s.cash.day||r.counted_at!==s.cash.counted_at||r.capture_recorded_at!==s.cash.as_of||r.counted_paise!==s.totals.counted_paise||Date.parse(r.recorded_at)<Date.parse(r.capture_recorded_at))return protocol();
 if(r.decision&&(r.decision.submission_id!==r.id||r.decision.actor_id===r.actor_id||r.decision.expected_version!==r.revision||Date.parse(r.decision.recorded_at)<Date.parse(r.recorded_at)))return protocol();
 if(r.status!=='superseded'&&r.status!==(r.decision?.kind==='approve'?'approved':r.decision?'rejected':'pending'))return protocol();return r;
};
const exportParse=object({id:uuid,definition:choice('agent_statement_v1'),schema_version:choice(1),organization_id:uuid,franchise_id:uuid,timezone:choice('Asia/Kolkata'),currency:choice('INR'),as_of:instant,expires_at:instant,count:integer(),source_count:integer(),statement_id:uuid,agent_id:uuid,day,revision:integer(1),status,counted_at:instant,source_as_of:instant});
export const statementExport:Decoder<ReturnType<typeof exportParse>>=value=>{
 const r=exportParse(value);if(r.count!==r.source_count||r.count>reportLimits.rows||Date.parse(r.expires_at)-Date.parse(r.as_of)!==reportLimits.lifetimeSeconds*1000||Date.parse(r.source_as_of)>Date.parse(r.as_of)||Date.parse(r.counted_at)>Date.parse(r.source_as_of)||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.counted_at))!==r.day)return protocol();return r;
};
export type StatementExport=ReturnType<typeof statementExport>;
const exportDownload=object({snapshot:statementExport,columns:array(text,statementExportColumns.length),csv:(value:unknown)=>typeof value==='string'&&new TextEncoder().encode(value).length<=reportLimits.bytes?value:protocol()});
export type StatementCapture=ReturnType<typeof statementCapture>;
export type StatementDetail=ReturnType<typeof statementDetail>;
export type StatementCaptureInput=ReturnType<typeof captureInput>;
export type StatementHeader=ReturnType<typeof statementHeader>;
export type StatementListRow=ReturnType<typeof listRow>;
export type StatementSubmissionInput=ReturnType<typeof submitInput>;
export type StatementReviewInput=ReturnType<typeof reviewInput>;
/** Private statement metadata. Source evidence is loaded separately for an explicit review. */
export function agentStatements(api:ScopedApi){
 const base='/api/v1/agent-settlements/submissions',at=(path:string)=>api.path(path);
 const actor=()=>api.scope.authority?.userId;
 const ownedExport=(value:unknown)=>{const r=statementExport(value);return r.organization_id===api.organization&&r.franchise_id===api.franchise?r:protocol();};
 return {
  captureExport:(id:string)=>api.intent('agent-statement.export.capture',at(base+'/'+uuid(id)+'/exports'),{}),
  executeExport:(intent:CommandIntent)=>api.execute(intent,value=>{const r=ownedExport(value);if(intent.operation!=='agent-statement.export.capture'||intent.path!==at(base+'/'+r.statement_id+'/exports')||intent.bodyJson!=='{}')return protocol();return r;}),
  downloadExport:(id:string,signal?:AbortSignal)=>api.read(at('/api/v1/agent-settlements/exports/'+uuid(id)+'/download'),value=>{
   const r=exportDownload(value);ownedExport(r.snapshot);if(r.snapshot.id!==id||r.columns.length!==statementExportColumns.length||r.columns.some((column,n)=>column!==statementExportColumns[n])||!r.csv.startsWith(statementExportColumns.map(c=>'"'+c+'"').join(',')+'\r\n')||!r.csv.endsWith('\r\n'))return protocol();return r;
  },signal),
  detail:(id:string,signal?:AbortSignal)=>api.read(at(base+'/'+uuid(id)),value=>{const r=statementDetail(value);return r.id===id?r:protocol();},signal),
  capture:(input:StatementCaptureInput)=>api.intent('agent-statement.capture',at('/api/v1/agent-settlements/cash-captures'),captureInput(input)),
  executeCapture:(intent:CommandIntent)=>api.execute(intent,value=>{
   const r=statementCapture(value),sent=captureInput(JSON.parse(intent.bodyJson));
   if(intent.operation!=='agent-statement.capture'||intent.path!==at('/api/v1/agent-settlements/cash-captures')||r.actor_id!==actor()||r.agent_id!==sent.agent_id||r.day!==sent.day||Date.parse(r.counted_at)!==Date.parse(sent.counted_at)||r.counted_paise!==String(sent.counted_paise)||r.reason!==sent.reason)return protocol();return r;
  }),
  list:(cursor?:string,signal?:AbortSignal)=>api.read(at(base)+(cursor===undefined?'':'&'+new URLSearchParams({cursor}).toString()),value=>{
   const r=list(value);if(new Set(r.items.map(i=>i.id)).size!==r.items.length||r.next_cursor!==null&&(!r.items.length||r.next_cursor.length>1024)||r.items.some(i=>{statementHeader(i);return Date.parse(i.recorded_at)>Date.parse(r.as_of);}))return protocol();return r;
  },signal),
  submit:(input:StatementSubmissionInput)=>{
   const r=submitInput(input);if((r.expected_version===0)!==(r.previous_submission_id===null)||r.expected_version>2147483646)return protocol();
   return api.intent('agent-statement.submit',at(base),r);
  },
  decide:(id:string,input:StatementReviewInput)=>{const r=reviewInput(input);if(r.expected_version>2147483647)return protocol();return api.intent('agent-statement.decide',at(base+'/'+uuid(id)+'/decisions'),r,'POST',r.expected_version);},
  executeSubmission:(intent:CommandIntent)=>api.execute(intent,value=>{
   const r=statementHeader(value),sent=submitInput(JSON.parse(intent.bodyJson));
   if(intent.operation!=='agent-statement.submit'||intent.path!==at(base)||r.actor_id!==actor()||r.capture_id!==sent.capture_id||r.previous_submission_id!==sent.previous_submission_id||r.revision!==sent.expected_version+1||r.reason!==sent.reason)return protocol();return r;
  }),
  executeDecision:(intent:CommandIntent)=>api.execute(intent,value=>{
   const r=statementReview(value),sent=reviewInput(JSON.parse(intent.bodyJson));
   if(intent.operation!=='agent-statement.decide'||intent.path!==at(base+'/'+r.submission_id+'/decisions')||r.actor_id!==actor()||r.kind!==sent.kind||r.expected_version!==sent.expected_version||r.reason!==sent.reason)return protocol();return r;
  }),
 };
}
export type AgentStatementSource=ReturnType<typeof agentStatements>;
