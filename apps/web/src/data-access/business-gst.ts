import {choice,integer,nullable,object,text,uuid} from './dto';
import type {ScopedApi} from './scoped-api';
export const businessGstDto=object({id:nullable(uuid),mode:nullable(choice('courier18','gta5','gta18','none')),supplier_state:text,version:integer()});
export const businessGstPath=(api:ScopedApi)=>`/api/v1/organizations/${api.organization}/franchises/${api.franchise}/tax/settings`;
export const gstModes=[{value:'courier18',label:'Courier — 18%'},{value:'gta5',label:'GTA — 5%'},{value:'gta18',label:'GTA — 18%'},{value:'none',label:'No GST'}];
