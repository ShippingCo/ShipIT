import React from 'react';
import {Msym} from '../m3/Icon';
import './dispatch-selection.css';
/** One label per checkbox keeps text and control aligned and keyboard accessible. */
export function DispatchSelection({label,checked,onChange,disabled=false,children}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean;children:React.ReactNode}){
 return <label className={`dispatch-choice${disabled?' is-disabled':''}`}><span className="dispatch-choice-copy">{children}</span><span className="check"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span className="box"><Msym name="check"/></span></span></label>;
}
