import React from 'react';
import * as Select from '@radix-ui/react-select';
import {Msym} from '../m3/Icon';

/** Small, finite choice sets: Radix supplies typeahead, arrow keys and focus return. */
export function ChoiceField({label,value,onChange,options,disabled=false,helper}:{label:string;value:string;onChange:(value:string)=>void;options:readonly {value:string;label:string}[];disabled?:boolean;helper?:string}){
 const id=React.useId();
 return <div className="tf workspace-choice"><label className="tf-label" id={`${id}-label`} htmlFor={id}>{label}</label>
  <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
   <Select.Trigger id={id} aria-labelledby={`${id}-label`} aria-describedby={helper?`${id}-help`:undefined} className="workspace-choice-trigger"><Select.Value/><Select.Icon><Msym name="expand_more"/></Select.Icon></Select.Trigger>
   <Select.Portal><Select.Content className="workspace-choice-menu" position="popper" sideOffset={6}><Select.Viewport>{options.map(option=><Select.Item className="workspace-choice-option" value={option.value} key={option.value}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Msym name="check"/></Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal>
  </Select.Root>{helper&&<span id={`${id}-help`} className="tf-help">{helper}</span>}
 </div>;
}
