import type {EffectivenessPage,EffectivenessFilter,EffectivenessSection} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const nonnegative=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:protocol();
const section=choice('messaging','assistant','queue');
const cell=object({section,category:text,count:nullable(integer()),suppressed:choice(true,false),denominator:nullable(integer()),denominator_kind:choice('logical_intents','measured_turns','case_events','active_cases','unknown'),excluded:nullable(integer()),latency_ms:nullable(nonnegative),business_minutes:nullable(nonnegative),age_suppressed:choice(true,false)});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('messaging_effectiveness_v1'),organization_id:uuid,franchise_id:uuid,filter:object({week:text}),count:integer(),timezone:choice('UTC'),as_of:instant,expires_at:instant,minimum_subjects:choice(5),freshness:object({state:choice('captured'),captured_at:instant}),staffing:object({state:choice('configured','unavailable'),timezone:nullable(text),weekdays:array(integer(),7),start_minute:nullable(integer()),end_minute:nullable(integer()),policy:choice('captured_current_schedule')})});
export const effectivenessPage:Decoder<EffectivenessPage>=object({snapshot,items:array(cell,100),selection:object({section:nullable(section),category:nullable(text)})});
export function effectiveness(api:ScopedApi) {
  const path='/api/v1/reports/effectiveness';
  const check=(p:EffectivenessPage)=>{if(p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;};
  return {
    intent(filter:EffectivenessFilter){return api.intent('effectiveness.capture',api.path(path),filter);},
    async execute(intent:CommandIntent){return check(await api.execute(intent,effectivenessPage,['$','Idempotency-Key']));},
    async page(id:string,signal?:AbortSignal,selected:EffectivenessSection|null=null,category:string|null=null){
      const p=check(await api.read(api.path(path+'/'+uuid(id))+'&'+new URLSearchParams({...selected===null?{}:{section:selected},...category===null?{}:{category}}),effectivenessPage,signal));
      if(p.snapshot.id!==id||p.selection.section!==selected||p.selection.category!==category)protocol();return p;
    },
  };
}
export type EffectivenessSource=ReturnType<typeof effectiveness>;

