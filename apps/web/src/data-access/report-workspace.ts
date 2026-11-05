import {object,array,uuid,text,instant,choice,protocol} from './dto';
import {amounts} from './sales';
import {performanceRow} from './performance';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const financeRow=object({id:uuid,confirmed_at:instant,rate:text,amounts});
const envelope={id:uuid,organization_id:uuid,franchise_id:uuid,as_of:instant,filter:object({from_day:text,to_day:text,sort:choice('confirmed_desc')}),export_token:text};
export type WorkspaceSale=ReturnType<typeof financeRow>;
export function reportWorkspace(api:ScopedApi){const check=<T extends {organization_id:string;franchise_id:string;filter:{from_day:string;to_day:string}}>(v:T,from:string,to:string)=>{if(v.organization_id!==api.organization||v.franchise_id!==api.franchise||v.filter.from_day!==from||v.filter.to_day!==to)return protocol();return v;};
 return {finance:async(from:string,to:string,signal?:AbortSignal)=>check(await api.read(api.path('/api/v1/reports/workspace/finance')+'&'+new URLSearchParams({from_day:from,to_day:to}),object({...envelope,rows:array(financeRow,5000)}),signal),from,to),delivery:async(from:string,to:string,signal?:AbortSignal)=>check(await api.read(api.path('/api/v1/reports/workspace/delivery')+'&'+new URLSearchParams({from_day:from,to_day:to}),object({...envelope,rows:array(performanceRow,5000)}),signal),from,to),authorize:(kind:'finance'|'delivery',token:string)=>api.intent('reports.workspace.export',api.path('/api/v1/reports/workspace/'+kind+'/export'),{export_token:token}),execute:(intent:CommandIntent)=>{if(intent.operation!=='reports.workspace.export')return protocol();return api.execute(intent,object({id:uuid}),['$']);}};
}
