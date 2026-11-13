import {useEffect, useRef, useState, type ReactNode} from 'react';
import {CounterScene, DispatchScene, HandoverScene} from './access-illustrations';
import './counter-identity.css';

const chapters = [
  {Scene:CounterScene, name:'At the counter', caption:'Every parcel gets one docket, and the customer gets the number.'},
  {Scene:DispatchScene, name:'On the route', caption:'Loads leave the branch together, and the shop can see where each one is.'},
  {Scene:HandoverScene, name:'At the door', caption:'A handover is recorded as proof, not remembered as a promise.'},
];

function ParcelMark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="10" fill="#174bb6"/>
    <path d="m8 15 12-6 12 6-12 6zM8 19l12 6 12-6M8 23l12 6 12-6" stroke="white" strokeWidth="2.25" strokeLinejoin="round"/>
  </svg>;
}

/**
 * What the software is, shown rather than described.
 *
 * This used to be a magazine cover: a masthead, an edition number, a monospace kicker, a 70px
 * display headline and a row of numbered chapter buttons — five competing voices beside a
 * sign-in form that only wanted to be quiet. It now holds one scene, one sentence, and three
 * thin segments to move between them.
 *
 * The scene sits directly on the panel with no frame of its own, so there is no box inside a
 * box, and it cross-fades rather than scrolling: a slower, quieter change that needs no
 * smooth-scroll machinery and no second rendering path for reduced motion.
 */
function JourneyPanel() {
  const [chapter,setChapter]=useState(0);
  const paused=useRef(false);
  useEffect(()=>{
    if(typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    // Slow enough to read the sentence twice; stopped for good the moment a person chooses.
    const timer=window.setInterval(()=>{if(!paused.current)setChapter(index=>(index+1)%chapters.length);},7000);
    return ()=>window.clearInterval(timer);
  },[]);
  const choose=(index:number)=>{paused.current=true;setChapter(index);};
  return <aside className="access-panel" aria-label="What ShippingCo does">
    <div className="panel-stage">
      {chapters.map((item,index)=>
        <div key={item.name} className={'panel-slide'+(index===chapter?' is-on':'')} aria-hidden={index!==chapter}>
          <item.Scene/>
        </div>)}
    </div>
    <div className="panel-say">
      <p className="panel-name">{chapters[chapter]!.name}</p>
      <p className="panel-caption">{chapters[chapter]!.caption}</p>
    </div>
    <div className="panel-steps" role="group" aria-label="Choose a stage">
      {chapters.map((item,index)=>
        <button type="button" key={item.name} className={index===chapter?'is-on':undefined}
          aria-pressed={index===chapter} onClick={()=>choose(index)}>
          <span className="workspace-visually-hidden">{item.name}</span>
        </button>)}
    </div>
  </aside>;
}

export function AccessLayout({children}:{children:ReactNode}) {
  return <main className="access-layout">
    <div className="access-brand"><ParcelMark/><strong>ShippingCo</strong></div>
    <div className="access-task">{children}</div>
    <JourneyPanel/>
  </main>;
}
