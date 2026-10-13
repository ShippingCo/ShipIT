import {useLayoutEffect,useEffect,useRef} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import type {ScopeController} from './scope';
import {settingsDeparture,settingsPending} from '../data-access/settings-session';
export function SettingsNavigationGuard({controller}:{controller:ScopeController}){
 const location=useLocation(),navigate=useNavigate(),prior=useRef(location),restoring=useRef<string|null>(null);
 useLayoutEffect(()=>{const previous=prior.current,target=location.pathname+location.search+location.hash;if(restoring.current===target){restoring.current=null;prior.current=location;return;}if(previous===location)return;if(previous.pathname==='/business/settings'&&!settingsDeparture(controller.runtime.ticket())){restoring.current=previous.pathname+previous.search+previous.hash;navigate(restoring.current,{replace:true});return;}prior.current=location;},[location,navigate,controller]);
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(settingsPending(controller.runtime.ticket())){event.preventDefault();event.returnValue='';}},change=(event:Event)=>{if(event.target instanceof HTMLSelectElement&&event.target.matches('select[aria-label="Franchise"]')&&!settingsDeparture(controller.runtime.ticket())){event.preventDefault();event.stopPropagation();event.target.value=controller.runtime.ticket().authority?.franchiseId??'';}};window.addEventListener('beforeunload',leave);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('change',change,true);};},[controller]);
 return null;
}
