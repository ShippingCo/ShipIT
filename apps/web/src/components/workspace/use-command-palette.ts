import {useEffect,useState} from 'react';

/** UI state only, safe to import into either data composition. */
export function useCommandPalette():[boolean,React.Dispatch<React.SetStateAction<boolean>>] {
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key?.toLowerCase()==='k'&&(event.metaKey||event.ctrlKey)){
        event.preventDefault();setOpen(value=>!value);
      }
    };
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[]);
  return [open,setOpen];
}
