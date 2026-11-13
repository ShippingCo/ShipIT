import React,{useCallback,useEffect,useRef} from 'react';
import {Msym} from '../m3/Icon';
import './form-errors.css';

/**
 * What a form refused, said once at the top and once beside each field.
 *
 * Until now a rejected save produced a single sentence somewhere on the page — "the server
 * rejected the change", "Settings could not be confirmed" — and the operator had to guess
 * which of a dozen fields was at fault. On a long form the message was often scrolled out of
 * sight entirely, so a press of Save looked like it did nothing at all.
 *
 * The pattern here is the one accessible forms have settled on: a summary at the top of the
 * form naming every problem, each entry a link that moves focus to the field it names. It
 * suits this product's readers twice over — the list is short, concrete, and can be worked
 * through one press at a time rather than read as prose.
 */
export interface FieldProblem {
  /** The id of the control this is about, so the summary can send focus to it. */
  id:string;
  /** What the operator calls the field. */
  label:string;
  /** What is wrong, in their words, not the server's. */
  message:string;
}

/** True when a reduced-motion preference is set, or when we cannot ask. */
const calm=()=>typeof window==='undefined'||typeof window.matchMedia!=='function'
  ||window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Bring a control into view and put the cursor in it.
 *
 * Centring matters more than it looks: a field scrolled to the very top of the viewport sits
 * under the sticky app bar on this console, and one scrolled to the bottom hides its own error
 * message. Focus follows the scroll so the next keystroke lands in the right place.
 */
function bring(target:HTMLElement) {
  // scrollIntoView is absent in jsdom and in some embedded browsers; losing the scroll must
  // never cost the focus, which is the half that actually lets the operator type.
  try { target.scrollIntoView({block:'center',behavior:calm()?'auto':'smooth'}); } catch { /* no scroll here; the focus below still lands */ }
  // Focus can itself scroll; let the scroll above own the movement.
  try { target.focus({preventScroll:true}); } catch { target.focus(); }
}

export function revealField(id:string) {
  const target=document.getElementById(id);
  if(!target)return false;
  bring(target);
  return true;
}

/** Move to the first control the form has marked invalid. Returns false when there is none. */
export function revealFirstProblem(form:HTMLElement|null|undefined,problems?:readonly FieldProblem[]) {
  if(problems?.length&&revealField(problems[0]!.id))return true;
  const invalid=form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if(!invalid)return false;
  bring(invalid);
  return true;
}

/**
 * The summary. It is a list, not a paragraph, and it takes focus when it appears so that a
 * screen reader announces it and a sighted operator is carried back to it from wherever the
 * page had scrolled to.
 */
export function FormErrors({problems,title='Check these before saving',note}:{
  problems:readonly FieldProblem[];title?:string;note?:string;
}) {
  const box=useRef<HTMLDivElement|null>(null);
  const signature=problems.map(problem=>problem.id+':'+problem.message).join('|');
  useEffect(()=>{
    if(!signature||!box.current)return;
    bring(box.current);
  },[signature]);
  const jump=useCallback((event:React.MouseEvent<HTMLAnchorElement>,id:string)=>{
    // Keep the hash out of the address bar; this is a move within one form, not a location.
    if(revealField(id))event.preventDefault();
  },[]);
  if(!problems.length)return null;
  return <div className="form-errors" role="alert" tabIndex={-1} ref={box}>
    <p className="form-errors-head"><Msym name="error" aria-hidden="true"/><strong>{title}</strong></p>
    <ul>
      {problems.map(problem=><li key={problem.id+problem.message}>
        <a href={'#'+problem.id} onClick={event=>jump(event,problem.id)}>{problem.label}</a>
        <span>{problem.message}</span>
      </li>)}
    </ul>
    {note&&<p className="form-errors-note">{note}</p>}
  </div>;
}
