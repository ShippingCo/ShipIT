import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Msym} from '../components/m3/Icon';
import {TextField} from '../components/m3/Input';
import {forgetPlace,readPlaces,rememberPlace,type HubPlace} from './hub-places';
import './hub-places.css';

/**
 * "Which hub?", asked the way a person would ask it.
 *
 * This replaces a text box labelled "Location reference (UUID)". The operator picks
 * the shed they are standing in from a row of named buttons, or writes its name once
 * and it joins the row. See hub-places.ts for where the names live and what that
 * means for the reference written into the custody record.
 */
export function HubPlacePicker({value,onChange,disabled,label='Which hub is the parcel at?',addLabel='Add a hub'}:{
  /** The chosen place, or null when nothing is chosen yet. */
  value:HubPlace|null;
  onChange:(place:HubPlace|null)=>void;
  disabled?:boolean;
  label?:string;
  addLabel?:string;
}) {
  const [places,setPlaces]=useState<HubPlace[]>(()=>readPlaces());
  const [adding,setAdding]=useState(false);
  const [name,setName]=useState('');
  const field=React.useRef<HTMLInputElement>(null);

  // The first run has no hubs at all, so open the one field that gets the operator
  // moving instead of showing an empty row and an Add button they have to find.
  useEffect(()=>{if(places.length===0)setAdding(true);},[places.length]);
  useEffect(()=>{if(adding)field.current?.focus();},[adding]);
  // Pre-select the hub used last: on a counter that only ever ships to one hub, that
  // makes this whole question answered before the operator looks at it.
  useEffect(()=>{if(!value&&places.length>0)onChange(places[0]!);},[value,places,onChange]);

  const commit=useCallback(()=>{
    const place=rememberPlace(name);
    if(!place)return;
    setPlaces(readPlaces());
    setName('');
    setAdding(false);
    onChange(place);
  },[name,onChange]);

  const taken=useMemo(()=>places.some(place=>place.name.toLowerCase()===name.trim().toLowerCase()),[places,name]);

  return <div className="hub-picker">
    <p className="hub-picker-label">{label}</p>
    {places.length>0&&<div className="hub-picker-row" role="radiogroup" aria-label={label}>
      {places.map(place=><button key={place.id} type="button" role="radio" disabled={disabled}
        aria-checked={value?.id===place.id} className="hub-chip"
        onClick={()=>{const used=rememberPlace(place.name);setPlaces(readPlaces());if(used)onChange(used);}}>
        <Msym name="warehouse"/><span>{place.name}</span>
      </button>)}
      {!adding&&<button type="button" className="hub-chip hub-chip-add" disabled={disabled} onClick={()=>setAdding(true)}>
        <Msym name="add"/><span>{addLabel}</span>
      </button>}
    </div>}
    {adding&&<div className="hub-picker-add">
      <TextField inputRef={field} id="hub-place-name" label="Name of the hub" value={name} disabled={disabled}
        maxLength={60} autoComplete="off"
        onChange={setName}
        onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}}}/>
      <div className="hub-picker-add-actions">
        <button type="button" className="btn btn-filled" disabled={disabled||!name.trim()} onClick={commit}>
          {taken?'Use this hub':'Save hub'}
        </button>
        {places.length>0&&<button type="button" className="btn btn-text" disabled={disabled} onClick={()=>{setAdding(false);setName('');}}>Cancel</button>}
      </div>
    </div>}
    {value&&!adding&&places.length>1&&<button type="button" className="hub-picker-forget" disabled={disabled}
      onClick={()=>{forgetPlace(value.id);const left=readPlaces();setPlaces(left);onChange(left[0]??null);}}>
      Remove “{value.name}” from this list
    </button>}
  </div>;
}
