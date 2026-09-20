import { HttpError } from '../../plugins/errors.ts';
import { digest } from '../pricing/idempotency.ts';
import type { Template } from './types.ts';
import { providerIdPattern } from './config.ts';

export const namePattern=/^[a-z][a-z0-9_]{0,511}$/;
export const languagePattern=/^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function normalizeTemplate(value:unknown):Template {
  if(!record(value)||typeof value.id!=='string'||!providerIdPattern.test(value.id)||typeof value.name!=='string'||!namePattern.test(value.name)||
    typeof value.language!=='string'||!languagePattern.test(value.language)||!Array.isArray(value.components)||value.components.length>10)throw new HttpError('WHATSAPP_PROVIDER_UNAVAILABLE');
  const status=typeof value.status==='string'&&['APPROVED','PENDING','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED','LIMIT_EXCEEDED'].includes(value.status)?value.status:'UNKNOWN';
  const category=typeof value.category==='string'&&['UTILITY','MARKETING','AUTHENTICATION'].includes(value.category)?value.category:'UNKNOWN';
  let supported=value.parameter_format===undefined||value.parameter_format==='POSITIONAL',bodies=0,count=0;
  const shape:unknown[]=[];
  for(const c of value.components) {
    if(!record(c)||typeof c.type!=='string'||typeof c.text!=='string'||c.text.length>4096){supported=false;continue;}
    shape.push({type:c.type,format:c.format??null,text:c.text});
    if(c.type==='BODY') {
      bodies++;
      const matches=[...c.text.matchAll(/\{\{([1-9][0-9]*)\}\}/g)].map(m=>Number(m[1]));
      const numbers=[...new Set(matches)].sort((a,b)=>a-b);count=numbers.length;
      if(count>20||numbers.some((n,i)=>n!==i+1)||/[{}]/.test(c.text.replace(/\{\{[1-9][0-9]*\}\}/g,'')))supported=false;
    }else if(!['HEADER','FOOTER'].includes(c.type)||(c.type==='HEADER'&&c.format!=='TEXT')||/[{}]/.test(c.text))supported=false;
  }
  supported=supported&&bodies===1;
  return {provider_id:value.id,name:value.name,language:value.language,status,category,shape_hash:digest({shape,parameter_format:value.parameter_format??'POSITIONAL',supported}),
    variables:Array.from({length:supported?count:0},()=>({type:'text' as const})),supported};
}
export function templateReason(template:Template|null):string|null {
  if(!template||template.status==='MISSING')return 'template_language_missing';
  if(template.status!=='APPROVED')return 'template_not_approved';
  if(!template.supported)return 'template_shape_unavailable';
  if(template.category!=='UTILITY')return 'template_category_unavailable';
  return null;
}
export function validVariables(template:Template,variables:unknown):variables is string[] {
  return Array.isArray(variables)&&variables.length===template.variables.length&&variables.every(v=>typeof v==='string'&&v.length>0&&v.length<=1024&&![...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127));
}
