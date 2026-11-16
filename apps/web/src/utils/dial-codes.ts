/**
 * The country codes a shop actually dials, and how long a number is in each.
 *
 * One list, used by both sign-in and the customer search, so the two screens cannot disagree
 * about what a phone number looks like. The lengths are here for one reason: so a mistyped
 * number can be named as mistyped — "a phone number is 10 digits, this one has 8" — at the
 * moment the field is left, rather than after a code has been sent nowhere.
 */
export const dialCodes=[
  {value:'91',label:'India (+91)',digits:10},
  {value:'1',label:'US / Canada (+1)',digits:10},
  {value:'44',label:'UK (+44)',digits:10},
  {value:'971',label:'UAE (+971)',digits:9},
  {value:'65',label:'Singapore (+65)',digits:8},
  {value:'61',label:'Australia (+61)',digits:9},
] as const;

export function nationalLength(dial:string):number|null {
  return dialCodes.find(code=>code.value===dial)?.digits??null;
}

/** Digits only, so a pasted "+91 98765-43210" or "098765 43210" still reads as ten digits. */
export function nationalDigits(typed:string,dial:string):string {
  let digits=typed.replace(/[^0-9]/g,'');
  if(digits.startsWith(dial)&&digits.length>dial.length)digits=digits.slice(dial.length);
  const expected=nationalLength(dial);
  // A single leading zero is how an Indian number is written down and dialled locally.
  if(digits.startsWith('0')&&expected!==null&&digits.length===expected+1)digits=digits.slice(1);
  return digits;
}

/** How the number is read back to the person who typed it. */
export function phoneDisplay(dial:string,digits:string):string {
  if(digits.length===10)return '+'+dial+' '+digits.slice(0,5)+' '+digits.slice(5);
  return '+'+dial+' '+digits;
}
