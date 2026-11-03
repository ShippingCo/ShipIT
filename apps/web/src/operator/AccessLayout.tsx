import {useEffect, useRef, useState, type ReactNode} from 'react';
import {gsap} from 'gsap';
import Lenis from 'lenis';
import counterPhoto from '../assets/access-photography/counter.webp';
import dispatchPhoto from '../assets/access-photography/dispatch.webp';
import handoverPhoto from '../assets/access-photography/handover.webp';
import './counter-identity.css';

const chapters = [
  {photo:counterPhoto,name:'Booking', title:'At the counter.', caption:'One docket for every parcel.'},
  {photo:dispatchPhoto,name:'Dispatch', title:'On the move.', caption:'From the branch to the delivery route.'},
  {photo:handoverPhoto,name:'Delivery', title:'At the door.', caption:'A handover, with proof of delivery.'},
];

function ParcelMark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="#174bb6"/>
    <path d="m8 15 12-6 12 6-12 6zM8 19l12 6 12-6M8 23l12 6 12-6" stroke="white" strokeWidth="2.25" strokeLinejoin="round"/>
  </svg>;
}

function JourneyPoster() {
  const wrapper=useRef<HTMLDivElement>(null),film=useRef<HTMLDivElement>(null);
  const [chapter,setChapter]=useState(0);
  const current=useRef(0);
  const move=useRef<(index:number)=>void>(()=>{});
  useEffect(()=>{
    const viewport=wrapper.current,content=film.current;
    if(!viewport||!content)return;
    const position=()=>{viewport.scrollTop=current.current*viewport.clientHeight;};
    move.current=position;
    const media=gsap.matchMedia();
    if(typeof window.matchMedia==='function')media.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)',()=>{
      const scroll=new Lenis({wrapper:viewport,content,autoRaf:false,smoothWheel:false,syncTouch:false,virtualScroll:()=>false});
      let frame=0;
      const tick=(time:number)=>{scroll.raf(time);if(scroll.isScrolling==='smooth')frame=requestAnimationFrame(tick);};
      move.current=index=>{
        cancelAnimationFrame(frame);
        scroll.scrollTo(index*viewport.clientHeight,{duration:.55,force:true});
        frame=requestAnimationFrame(tick);
      };
      gsap.fromTo(content.querySelector('.dispatch-photo'),{scale:1.035,transformOrigin:'50% 50%'},{scale:1,duration:1,ease:'power3.out'});
      return ()=>{cancelAnimationFrame(frame);scroll.destroy();move.current=position;position();};
    });
    window.addEventListener('resize',position);
    return ()=>{media.revert();window.removeEventListener('resize',position);move.current=()=>{};};
  },[]);
  const choose=(index:number)=>{current.current=index;setChapter(index);move.current(index);};
  return <aside className="access-poster" aria-label="A parcel’s journey">
    <div className="poster-mast"><span className="poster-insignia" aria-hidden="true">↗</span> ShippingCo Dispatch <span className="poster-edition">Field series / 01</span></div>
    <div className="poster-window" ref={wrapper}><div className="poster-film" ref={film}>
      {chapters.map((item,index)=><div className="poster-slide" key={item.name} aria-hidden={index!==chapter}>
        <span className="poster-kicker">0{index+1} / {item.name}</span><p className="poster-title">{item.title}</p>
        <figure className="dispatch-photo-frame"><img className="dispatch-photo" src={item.photo} width={1536} height={1024} alt="" decoding="async"/></figure><p className="poster-caption">{item.caption}</p>
      </div>)}
    </div></div>
    <div className="poster-controls" aria-label="Journey stages">{chapters.map((item,index)=><button type="button" key={item.name} aria-pressed={chapter===index} onClick={()=>choose(index)}><span>0{index+1}</span>{item.name}</button>)}</div>
  </aside>;
}

export function AccessLayout({children}:{children:ReactNode}) {
  return <main className="access-layout">
    <div className="access-brand"><ParcelMark/><strong>ShippingCo</strong>
      <svg className="access-brand-route" viewBox="0 0 116 38" fill="none" aria-hidden="true">
        <path d="M5 29h29c16 0 9-20 25-20h48" stroke="#6c8cae" strokeWidth="1" strokeDasharray="2 3"/>
        <path className="access-brand-ink" pathLength="1" d="M5 29h29c16 0 9-20 25-20h48" stroke="#bad5f5" strokeWidth="2"/>
        <circle cx="5" cy="29" r="3" fill="#bed6f2"/><circle cx="107" cy="9" r="4" fill="#f5c269"/>
      </svg></div>
    <div className="access-task">{children}</div>
    <JourneyPoster/>
  </main>;
}
