import {validPhone} from './form';

export function customerSearchError(by:'name'|'phone',query:string):string {
 if(by==='phone')return query.length>40?'Use no more than 40 characters for the phone number.':validPhone(query)?'':'Choose a country code and enter the full phone number.';
 const value=query.trim();
 if([...value].length>120)return 'Use no more than 120 characters for the name.';
 if([...value].some(c=>{const n=c.codePointAt(0)!;return n<32||n>=127&&n<=159||n>=0xd800&&n<=0xdfff;}))return 'Enter the customer name on one line.';
 return (value.match(/[\p{L}\p{N}]/gu)?.length??0)<3?'Enter the first 3 letters or numbers of the name, as saved.':'';
}
