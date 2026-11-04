import {useState} from 'react';
import {TextField} from '../components/m3/Input';

/** Decimal input is scaled using strings/BigInt, never floating-point multiplication. */
export function decimalUnits(value:string,places:2|3):string|null {
  if(!new RegExp(`^\\d+(?:\\.\\d{0,${places}})?$`).test(value))return null;
  const [whole,fraction='']=value.split('.');
  const integer=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
  return integer<=BigInt(Number.MAX_SAFE_INTEGER)?integer.toString():null;
}
export function displayUnits(value:string,places:2|3):string {
  if(!/^\d+$/.test(value))return '';
  const integer=BigInt(value),scale=10n**BigInt(places),fraction=String(integer%scale).padStart(places,'0').replace(/0+$/,'');
  return String(integer/scale)+(fraction?'.'+fraction:'');
}
export function UnitField({value,onChange,places,...props}:Omit<Parameters<typeof TextField>[0],'value'|'onChange'|'inputMode'>&{value:string;onChange:(value:string)=>void;places:2|3}) {
  const [editing,setEditing]=useState<{text:string;integer:string}>();
  const displayed=editing?.integer===value?editing.text:displayUnits(value,places);
  return <TextField {...props} inputMode="decimal" value={displayed} onChange={text=>{
    // Keep invalid non-empty input invalid even when the field is optional (override).
    // An invalid price must never turn silently into an omitted override.
    const integer=decimalUnits(text,places)??(text?'invalid-decimal:'+text:'');
    setEditing({text,integer});onChange(integer);
  }}/>;
}
