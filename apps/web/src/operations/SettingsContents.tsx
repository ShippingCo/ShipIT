import {useEffect,useState} from 'react';

const destinations = [
  {id:'booking-policy-setup',label:'Booking setup'},
  {id:'settings-preferences-title',label:'Business preferences'},
  {id:'settings-history-title',label:'Settings change history'},
];

export function SettingsContents({history}:{history:boolean}) {
  const [active,setActive]=useState(destinations[0].id);
  useEffect(()=>{
    const update=()=>{
      const topbar=document.querySelector('.appbar')?.getBoundingClientRect().bottom ?? 64;
      const visible=destinations.filter(({id})=>{
        const section=document.getElementById(id);
        return section && section.getBoundingClientRect().top <= topbar+48;
      });
      setActive(visible.at(-1)?.id ?? destinations[0].id);
    };
    update();
    window.addEventListener('scroll',update,{passive:true});
    return ()=>window.removeEventListener('scroll',update);
  },[history]);
  return <nav aria-label="Settings sections" className="settings-contents">
    <span className="settings-contents-label">On this page</span>
    {destinations.slice(0,history?3:2).map(({id,label})=>
      <button type="button" key={id} aria-current={active===id?'location':undefined} onClick={()=>{
        const target=document.getElementById(id);
        target?.focus({preventScroll:true});
        target?.scrollIntoView?.({block:'start'});
      }}>{label}</button>
    )}
  </nav>;
}
