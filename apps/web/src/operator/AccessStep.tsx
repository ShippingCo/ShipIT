import {useEffect,useRef} from 'react';
import {gsap} from 'gsap';

export function AccessStep({stage}:{stage:'email'|'verify'|'shop'}) {
  const drawing=useRef<SVGSVGElement>(null);
  useEffect(()=>{
    if(!drawing.current||typeof window.matchMedia!=='function')return;
    const media=gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)',()=>{
      const path=drawing.current?.querySelector('path');
      if(path)gsap.fromTo(path,{strokeDasharray:1,strokeDashoffset:1},{strokeDashoffset:0,duration:.48,ease:'power2.out'});
    });
    return ()=>media.revert();
  },[stage]);
  const verify=stage==='verify',shop=stage==='shop';
  return <div className="access-stage"><svg ref={drawing} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path key={stage} pathLength="1" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
      d={verify?'M3 13 28 4l-7 24-7-9-11-6Zm11 6L28 4':shop?'M5 14h22l-3-8H8l-3 8Zm3 1v12h16V15M13 27v-8h6v8':'M4 8h24v17H4zM4 9l12 9L28 9'}/>
  </svg>{shop?'Shop details':verify?'Email verification':'Email access'}</div>;
}
