import { HttpError } from '../../plugins/errors.ts';
import { resourceTypes, type AuditFilter, type ResourceType } from './types.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function filterInput(input:unknown):AuditFilter {
  const fail=():never=>{throw new HttpError('VALIDATION_FAILED');};
  if(!input || typeof input!=='object' || Array.isArray(input)) return fail();
  const v=input as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['organization_id','franchise_id','resource_type','resource_id','from','to','limit','cursor','sort'].includes(k))) return fail();
  for(const [k,x] of Object.entries(v)) if(typeof x!=='string' || x.length>(k==='cursor'?4096:128)) return fail();
  const id=(x:unknown)=>typeof x==='string'&&uuid.test(x)?x:fail();
  const date=(x:unknown)=>{
    if(x===undefined)return null;
    if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x))return fail();
    const d=new Date(x);
    if(x.startsWith('0000-')||!Number.isFinite(d.getTime())||d.toISOString().slice(0,19)!==x.slice(0,19))return fail();
    return d.toISOString();
  };
  if(v.cursor==='')throw new HttpError('CURSOR_INVALID');
  const limit=v.limit===undefined?50:Number(v.limit);
  if(v.limit!==undefined&&!/^[1-9][0-9]*$/.test(v.limit as string)||!Number.isSafeInteger(limit)||limit>100||limit<1)return fail();
  if(v.sort!==undefined&&v.sort!=='occurred_at_desc')return fail();
  if(v.resource_type!==undefined&&!resourceTypes.includes(v.resource_type as ResourceType))return fail();
  if(v.resource_id!==undefined&&v.resource_type===undefined)return fail();
  const from=date(v.from),to=date(v.to);
  if(from&&to&&from>=to)return fail();
  return {organizationId:id(v.organization_id),franchiseId:v.franchise_id===undefined?null:id(v.franchise_id),
    resourceType:v.resource_type as ResourceType??null,resourceId:v.resource_id===undefined?null:id(v.resource_id),
    from,to,limit,cursor:v.cursor as string??null};
}
