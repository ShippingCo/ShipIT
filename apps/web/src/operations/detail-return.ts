import {useEffect,useRef} from 'react';
/** Memory-only return position; discarded with the scoped workspace. */
export function useDetailReturn(selected:string|null) {
 const previous=useRef<string|null>(null),saved=useRef<{element:HTMLElement|null;x:number;y:number;ancestors:{element:HTMLElement;top:number;left:number}[]}|null>(null);
 useEffect(()=>{if(previous.current&&!selected&&saved.current){const position=saved.current;position.element?.focus({preventScroll:true});for(const item of position.ancestors){item.element.scrollTop=item.top;item.element.scrollLeft=item.left;}window.scrollTo?.(position.x,position.y);saved.current=null;}previous.current=selected;},[selected]);
 return ()=>{const element=document.activeElement instanceof HTMLElement?document.activeElement:null,ancestors:{element:HTMLElement;top:number;left:number}[]=[];for(let parent=element?.parentElement;parent;parent=parent.parentElement)ancestors.push({element:parent,top:parent.scrollTop,left:parent.scrollLeft});saved.current={element,x:window.scrollX,y:window.scrollY,ancestors};};
}
