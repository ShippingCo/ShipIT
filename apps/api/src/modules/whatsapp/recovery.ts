/** W44 eligibility shared by the command and safe read projection. Authorization is separate. */
export function redriveReason(state:string,renderingAvailable:boolean,expires:Date,progress:number,now:Date) {
  if(!renderingAvailable||expires<=now||progress>=2)return null;
  return state==='failed'?'dependency_repaired':state==='uncertain'?'retry_uncertain_confirmed':null;
}
