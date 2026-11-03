import {useState} from 'react';
import {SelectField,TextField} from '../components/m3/Input';
import './phone-field.css';

const countries=[{value:'91',label:'India (+91)'},{value:'1',label:'US / Canada (+1)'},{value:'44',label:'UK (+44)'},{value:'971',label:'UAE (+971)'},{value:'65',label:'Singapore (+65)'},{value:'61',label:'Australia (+61)'},{value:'other',label:'Other country'}];
export function splitPhone(value:string,fallback='91') {
 const trimmed=value.trimStart();
 if(!trimmed.startsWith('+'))return {country:fallback,number:value};
 const country=countries.filter(c=>c.value!=='other').sort((a,b)=>b.value.length-a.value.length).find(c=>trimmed.startsWith('+'+c.value));
 return country?{country:country.value,number:trimmed.slice(country.value.length+1).replace(/^[ -]+/,'')}:{country:'other',number:value};
}
/** The draft remains a full international phone. National entry never changes server validation. */
export function PhoneField({label,value,onChange,helper,compact=false,...props}:Omit<Parameters<typeof TextField>[0],'label'|'value'|'onChange'|'inputMode'|'type'>&{label:string;value:string;onChange:(value:string)=>void;compact?:boolean}) {
 const [preferred,setPreferred]=useState('91'),[selection,setSelection]=useState<{country:string;value:string}>();
 const derived=splitPhone(value,preferred),parts=selection?.value===value?{country:selection.country,number:selection.country==='other'?value:derived.number}:derived;
 if(compact)return <TextField {...props} label={label} type="tel" inputMode="tel" autoComplete="tel" value={derived.country==='91'?derived.number:value} helper={helper??'India +91. For other countries, include the country code.'} onChange={number=>onChange(number.trimStart().startsWith('+')?number:number?'+91 '+number:'')}/>;
 return <div className="counter-phone-field"><div className="counter-phone-controls">
  <SelectField label="Country code" aria-label={label+' country code'} value={parts.country} disabled={props.disabled} options={countries} onChange={country=>{
   const number=splitPhone(value,preferred).number,next=number?(country==='other'?value:'+'+country+' '+number):'';
   setPreferred(country);setSelection({country,value:next});onChange(next);
  }}/>
  <TextField {...props} label={label} type="tel" inputMode="tel" autoComplete="tel-national" value={parts.number} helper={helper??(parts.country==='91'?'Enter the 10-digit number. +91 is added for you.':'Enter the local number, or paste a full number starting with +.')} onChange={number=>{
   const next=number.trimStart().startsWith('+')||parts.country==='other'?number:number?'+'+parts.country+' '+number:'';
   const country=splitPhone(next,parts.country).country;setPreferred(country);setSelection({country,value:next});onChange(next);
  }}/>
 </div></div>;
}
