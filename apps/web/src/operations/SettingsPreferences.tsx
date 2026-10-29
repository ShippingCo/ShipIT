import {useMemo,useSyncExternalStore} from 'react';
import {useLocation} from 'react-router-dom';
import type {OperatorRole,SettingResult} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import type {BookingWorkflow} from '../booking/workflow';
import {scopedApi} from '../data-access/scoped-api';
import {settings} from '../data-access/settings';
import {useResource} from './hooks';
export type ReportPreference=SettingResult<'report_scope'>|null;
export function OperatorDisplayPreference({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const location=useLocation(),source=useMemo(()=>settings(scopedApi(controller)),[controller]);
 const data=useResource('display-preference-'+location.key,signal=>roles.some(r=>r!=='delivery_agent')?source.read('franchise',signal):Promise.resolve(null));
 const preference=data.value?.values.identity;
 return preference?.availability==='available'&&preference.value?<p className="ops-note service-display-preference">Operator display: <strong>{preference.value.display_name}</strong> · {preference.state}, version {preference.source?.version}. Legal issuer and franchise identity remain unchanged.</p>:null;
}
export function BookingPreference({workflow}:{workflow:BookingWorkflow}){
 const source=useMemo(()=>settings(workflow.api),[workflow]),state=useSyncExternalStore(workflow.subscribe,workflow.snapshot);
 const data=useResource('booking-preference',signal=>source.read('franchise',signal)),p=data.value?.values.booking_defaults;
 if(data.phase==='error')return <p role="status">Configured service suggestion is unavailable. Choose the service explicitly.</p>;
 if(!p||p.availability!=='available'||!p.value||!p.source)return <p>Booking service preference is unconfigured.</p>;
 return <div className="ops-note service-preference-note"><p>Configured service: {p.value.service.replaceAll('_',' ')} · {p.state}, version {p.source.version}. Applies only when accepted for this new draft.</p><button type="button" className="btn btn-outlined" disabled={workflow.locked()||!!state.quote} onClick={()=>workflow.acceptServiceSuggestion(p.value!.service,p.source!.version_id)}>Use configured service</button>{state.settingsVersion&&<p role="status">Accepted settings source {state.settingsVersion}. Manually changing Service removes this preference reference.</p>}</div>;
}
export function ReportPreferenceControl({preference,disabled,accept}:{preference?:ReportPreference;disabled:boolean;accept:(ids:string[],version:string)=>void}){
 if(preference===undefined)return null;
 if(!preference||preference.state==='unconfigured')return <p>Report scope preference is unconfigured. Choose from your currently authorized franchises.</p>;
 if(preference.availability!=='available'||!preference.value||!preference.source)return <p role="status">Configured report scope is unavailable under current access. It has not been substituted or expanded. Choose a permitted scope explicitly or ask an administrator to replace the preference.</p>;
 return <div className="ops-note service-preference-note"><p>Configured report scope: {preference.value.franchise_ids.length} franchises · {preference.state}, version {preference.source.version}. Only a new capture can use this suggestion.</p><button type="button" className="btn btn-outlined" disabled={disabled} onClick={()=>accept(preference.value!.franchise_ids,preference.source!.version_id)}>Use configured report scope</button></div>;
}
