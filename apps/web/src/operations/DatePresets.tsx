import {datePreset} from './business-dates';
export function DatePresets({change,disabled=false}:{change:(from:string,to:string)=>void;disabled?:boolean}) {
 return <div className="ops-actions" aria-label="Business date presets">{(['today','week'] as const).map(kind=><button key={kind} type="button" className="btn btn-outlined" disabled={disabled} onClick={()=>{const range=datePreset(kind);change(range.from,range.to);}}>{kind==='today'?'Today':'This week'}</button>)}<span className="ops-note">Asia/Kolkata · week starts Monday; through today</span></div>;
}
