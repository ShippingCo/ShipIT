import type {AgentMoneyCatalog,AgentMoneySourceMap,AgentMoneySourcePage} from '@shippingco/shared';
import {array,choice,instant,integer,nullable,object,protocol,text,uuid,type Decoder} from './dto';
import {statementMoney as exactMoney} from './agent-statement-evidence';
import type {CommandIntent} from './command-intent';
import type {ScopedApi} from './scoped-api';
const money:Decoder<string>=value=>{const r=exactMoney(value);return BigInt(r)>=0n?r:protocol();};
const common={id:uuid,recorded_at:instant},revision={revision_id:uuid,version:integer(1)},method=choice('cash','upi','card','bank_transfer','other'),basis=choice('per_delivery','agreed_period');
const beneficiary=object({...common,...revision,name:text,active:choice(true,false)});
const obligation=object({...common,...revision,booking_id:uuid,parcel_id:uuid,customer_id:uuid,beneficiary_id:uuid,beneficiary_revision_id:uuid,amount_paise:money,active:choice(true,false)});
const allocationParse=object({...common,receipt_id:uuid,obligation_id:uuid,obligation_revision_id:uuid,beneficiary_id:uuid,beneficiary_revision_id:uuid,collected_paise:money,remitted_paise:money,reversed_paise:money,reserved_paise:money,remaining_paise:money});
const allocation:Decoder<ReturnType<typeof allocationParse>>=value=>{const r=allocationParse(value);if(BigInt(r.collected_paise)-BigInt(r.reversed_paise)!==BigInt(r.reserved_paise)||BigInt(r.reserved_paise)-BigInt(r.remitted_paise)!==BigInt(r.remaining_paise))return protocol();return r;};
const termsParse=object({...common,...revision,agent_id:uuid,basis,amount_paise:money,valid_from:instant,valid_until:instant,active:choice(true,false)});
const terms:Decoder<ReturnType<typeof termsParse>>=value=>{const r=termsParse(value);if(r.id!==r.agent_id||BigInt(r.amount_paise)<=0n||Date.parse(r.valid_from)>=Date.parse(r.valid_until))return protocol();return r;};
const feeParse=object({...common,agent_id:uuid,term_revision_id:uuid,basis,proof_id:nullable(uuid),parcel_id:nullable(uuid),covered_from:nullable(instant),covered_until:nullable(instant),earned_paise:money,expense_paise:money,direct_paid_paise:money,cash_paid_paise:money,noncash_paid_paise:money,advance_applied_paise:money,remaining_paise:money});
const fee:Decoder<ReturnType<typeof feeParse>>=value=>{const r=feeParse(value),earned=BigInt(r.earned_paise);if(earned<=0n||![0n,earned].includes(BigInt(r.expense_paise))||BigInt(r.direct_paid_paise)!==BigInt(r.cash_paid_paise)+BigInt(r.noncash_paid_paise)||earned-BigInt(r.direct_paid_paise)-BigInt(r.advance_applied_paise)!==BigInt(r.remaining_paise))return protocol();if(r.basis==='per_delivery'){if(!r.proof_id||!r.parcel_id||r.covered_from!==null||r.covered_until!==null)return protocol();}else if(r.proof_id!==null||r.parcel_id!==null||!r.covered_from||!r.covered_until||Date.parse(r.covered_from)>=Date.parse(r.covered_until))return protocol();return r;};
const advanceParse=object({...common,head_request_id:uuid,agent_id:uuid,payment_method:method,paid_paise:money,applied_paise:money,remaining_paise:money});
const advance:Decoder<ReturnType<typeof advanceParse>>=value=>{const r=advanceParse(value);if(BigInt(r.paid_paise)-BigInt(r.applied_paise)!==BigInt(r.remaining_paise))return protocol();return r;};
const proof=object({...common,parcel_id:uuid,agent_id:uuid,completed_at:instant,earning_id:nullable(uuid)});
const receiptParse=object({...common,account_id:uuid,customer_id:uuid,receiver_id:uuid,initial_custodian_id:nullable(uuid),method,amount_paise:money,freight_applied_paise:money,cod_reserved_paise:money,available_paise:money,occurred_at:instant});
const receipt:Decoder<ReturnType<typeof receiptParse>>=value=>{const r=receiptParse(value);if(BigInt(r.amount_paise)<=0n||BigInt(r.amount_paise)-BigInt(r.freight_applied_paise)-BigInt(r.cod_reserved_paise)!==BigInt(r.available_paise)||(r.method==='cash')!==(r.initial_custodian_id!==null))return protocol();return r;};
const parcel=object({...common,booking_id:uuid,customer_id:uuid,docket:text,obligation_id:nullable(uuid)});
const decoders:{[K in AgentMoneyCatalog]:Decoder<AgentMoneySourceMap[K]>}={beneficiaries:beneficiary,obligations:obligation,allocations:allocation,'fee-terms':terms,'fee-earnings':fee,advances:advance,proofs:proof,receipts:receipt,parcels:parcel};
/** Validate each live page independently. Pages do not promise a single frozen cutoff. */
export function moneySourcePage<K extends AgentMoneyCatalog>(kind:K,value:unknown):AgentMoneySourcePage<K>{
 const parse=object({kind:choice(kind),organization_id:uuid,franchise_id:uuid,as_of:instant,timezone:choice('Asia/Kolkata'),currency:choice('INR'),items:array(decoders[kind],100),next_cursor:nullable(text)}),r=parse(value);
 if(r.next_cursor!==null&&(!r.items.length||!r.next_cursor||r.next_cursor.length>1024)||r.items.some((item,n)=>Date.parse(item.recorded_at)>Date.parse(r.as_of)||n>0&&item.id<=r.items[n-1]!.id))return protocol();
 return r;
}
const version:Decoder<number>=value=>{const r=integer()(value);return r<=2147483645?r:protocol();};
const amount:Decoder<number>=value=>integer(1)(value);
const name:Decoder<string>=value=>{const r=text(value).trim();return r.length>0&&r.length<=120?r:protocol();};
const beneficiaryInput=object({expected_version:version,name,active:choice(true,false)});
const obligationInput=object({booking_id:uuid,parcel_id:uuid,expected_version:version,beneficiary_id:uuid,beneficiary_revision_id:uuid,amount_paise:amount,currency:choice('INR'),active:choice(true,false)});
const allocationInput=object({receipt_id:uuid,obligation_id:uuid,obligation_revision_id:uuid,amount_paise:amount,currency:choice('INR')});
const termInputParse=object({expected_version:version,basis,amount_paise:amount,currency:choice('INR'),valid_from:instant,valid_until:instant,active:choice(true,false)});
const termInput:Decoder<ReturnType<typeof termInputParse>>=value=>{const r=termInputParse(value);return Date.parse(r.valid_from)<Date.parse(r.valid_until)?r:protocol();};
const deliveryInput=object({proof_id:uuid,term_revision_id:uuid}),agreedInput=object({term_revision_id:uuid});
const commandResult=object({command_id:uuid,resource_id:uuid,recorded_at:instant});
export type MoneyCommandResult=ReturnType<typeof commandResult>;
export function agentMoney(api:ScopedApi){
 const base='/api/v1/agent-settlements',at=(path:string)=>api.path(base+path);
 function intent(operation:string,path:string,input:unknown,decode:Decoder<unknown>){return api.intent('agent-money.'+operation,at(path),decode(input));}
 return {
 list:<K extends AgentMoneyCatalog>(kind:K,cursor?:string,signal?:AbortSignal)=>api.read(at('/finance/'+kind)+(cursor===undefined?'':'&'+new URLSearchParams({cursor}).toString()),value=>{const r=moneySourcePage(kind,value);if(r.organization_id!==api.organization||r.franchise_id!==api.franchise)return protocol();return r;},signal),
 beneficiary:(id:string|null,input:ReturnType<typeof beneficiaryInput>)=>intent('beneficiary',id===null?'/cod-beneficiaries':'/cod-beneficiaries/'+uuid(id)+'/revisions',input,beneficiaryInput),
 obligation:(id:string|null,input:ReturnType<typeof obligationInput>)=>intent('obligation',id===null?'/cod-obligations':'/cod-obligations/'+uuid(id)+'/revisions',input,obligationInput),
 reserve:(input:ReturnType<typeof allocationInput>)=>intent('reserve','/cod-allocations',input,allocationInput),
 terms:(agent:string,input:ReturnType<typeof termInput>)=>intent('terms','/agents/'+uuid(agent)+'/fee-terms',input,termInput),
 earnDelivery:(input:ReturnType<typeof deliveryInput>)=>intent('delivery','/fee-earnings/delivery',input,deliveryInput),
 earnAgreed:(input:ReturnType<typeof agreedInput>)=>intent('agreed','/fee-earnings/agreed',input,agreedInput),
 execute:(command:CommandIntent)=>{
  const operation=command.operation.slice('agent-money.'.length),sent=JSON.parse(command.bodyJson),path=command.path.split('?')[0],rules:Record<string,{decode:Decoder<unknown>;path:RegExp}>={beneficiary:{decode:beneficiaryInput,path:/^\/cod-beneficiaries(?:\/[0-9a-f-]{36}\/revisions)?$/},obligation:{decode:obligationInput,path:/^\/cod-obligations(?:\/[0-9a-f-]{36}\/revisions)?$/},reserve:{decode:allocationInput,path:/^\/cod-allocations$/},terms:{decode:termInput,path:/^\/agents\/[0-9a-f-]{36}\/fee-terms$/},delivery:{decode:deliveryInput,path:/^\/fee-earnings\/delivery$/},agreed:{decode:agreedInput,path:/^\/fee-earnings\/agreed$/}},rule=rules[operation];
  if(!command.operation.startsWith('agent-money.')||!rule||!path?.startsWith(base)||!rule.path.test(path.slice(base.length))||command.path!==at(path.slice(base.length))||command.method!=='POST'||JSON.stringify(rule.decode(sent))!==command.bodyJson)return protocol();
  return api.execute(command,commandResult,['expected_version','name','active','booking_id','parcel_id','beneficiary_id','beneficiary_revision_id','receipt_id','obligation_id','obligation_revision_id','amount_paise','currency','basis','valid_from','valid_until','proof_id','term_revision_id','$']);
 },
};}
