import {useCallback,useEffect} from 'react';
import {accountNavigationPending,accountNavigationBlocked} from '../data-access/account-navigation';
import {useBlocker} from 'react-router-dom';
import type {ScopeController} from './scope';
import {settingsDeparture,settingsPending} from '../data-access/settings-session';
export function SettingsNavigationGuard({controller}:{controller:ScopeController}){
 // React Router restores a blocked POP's index before proceeding or resetting;
 // no destination entry is replaced and blocked PUSHes never enter history.
 const blocker=useBlocker(useCallback(({currentLocation}:{currentLocation:{pathname:string}})=>accountNavigationPending(controller.runtime.ticket())||(currentLocation.pathname==='/business/settings'&&settingsPending(controller.runtime.ticket())),[controller]));
 useEffect(()=>{if(blocker.state==='blocked'){if(accountNavigationPending(controller.runtime.ticket())){accountNavigationBlocked(controller.runtime.ticket());blocker.reset();return;}if(settingsDeparture(controller.runtime.ticket()))blocker.proceed();else blocker.reset();}},[blocker,controller]);
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(settingsPending(controller.runtime.ticket())||accountNavigationPending(controller.runtime.ticket())){event.preventDefault();event.returnValue='';}},change=(event:Event)=>{if(event.target instanceof HTMLSelectElement&&event.target.matches('select[aria-label="Franchise"]')&&(accountNavigationPending(controller.runtime.ticket())||!settingsDeparture(controller.runtime.ticket()))){event.preventDefault();event.stopPropagation();if(accountNavigationPending(controller.runtime.ticket()))accountNavigationBlocked(controller.runtime.ticket());event.target.value=controller.runtime.ticket().authority?.franchiseId??'';}};window.addEventListener('beforeunload',leave);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('change',change,true);};},[controller]);
 return null;
}
