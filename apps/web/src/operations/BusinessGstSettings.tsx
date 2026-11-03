import {useEffect,useMemo,useState} from 'react';
import {canAdminister} from '@shippingco/shared';
import type {OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {businessGstDto,businessGstPath,gstModes} from '../data-access/business-gst';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {TextField,SelectField} from '../components/m3/Input';
import {SectionHeader} from '../components/workspace/Workspace';
import {useCommand,useResource} from './hooks';
import {CommandNotice} from './AsyncState';
import {bookingStates} from '../booking/states';
export function BusinessGstSettings({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),path=businessGstPath(api);
 const current=useResource(path,signal=>api.read(path,businessGstDto,signal));
 const command=useCommand(intent=>api.execute(intent,businessGstDto));
 const [mode,setMode]=useState('courier18'),[state,setState]=useState(''),[gstin,setGstin]=useState('');
 const busy=command.phase==='pending'||command.phase==='uncertain',admin=canAdminister(roles,'tax.publish');
 const [blocked,setBlocked]=useState(false);
 useEffect(()=>{if(current.value){setMode(current.value.mode??'courier18');setState(current.value.supplier_state);}},[current.value]);
 useEffect(()=>{
  if(!busy)return;
  const release=retainAccountNavigation(api.scope,()=>setBlocked(true));
  const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  const navigate=(e:MouseEvent)=>{if(e.target instanceof Element&&e.target.closest('a[href]')){e.preventDefault();e.stopPropagation();setBlocked(true);}};
  window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);
  return()=>{release();window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);};
 },[busy,api.scope]);
 async function save(){try{await command.run(api.intent('tax.configure',path,{mode,supplier_state:state,supplier_gstin:gstin,expected_version:current.value?.version??0}));setGstin('');current.reload();}catch{/* CommandNotice provides retry/error recovery. */}}
 async function retry(){try{if(await command.retry()){setGstin('');current.reload();}}catch{/* Keep the original command for an uncertain response. */}}
 return <section className="ops-card" aria-label="GST settings"><SectionHeader title="GST"/>
  {current.phase==='error'?<p role="alert">GST settings could not be loaded. <button className="btn btn-text" onClick={current.reload}>Retry</button></p>:<form className="ops-form" onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||current.phase==='loading'||!admin}><legend className="sr-only">GST settings</legend><div className="ops-form-grid">
   <SelectField label="GST treatment" options={gstModes} value={mode} onChange={setMode}/>
   <SelectField label="Business state" options={[{value:'',label:'Choose state'},...bookingStates]} value={state} onChange={setState} required/>
   {admin&&<TextField label="GSTIN" value={gstin} onChange={setGstin} maxLength={15} required={!current.value?.id} helper={current.value?.id?'Leave blank to keep the saved GSTIN.':undefined}/>}
  </div></fieldset>{admin&&<button className="btn btn-filled" disabled={busy||current.phase==='loading'} type="submit">{command.phase==='pending'?'Saving…':'Save'}</button>}</form>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>void retry():undefined}/>
  {command.phase==='confirmed'&&<p role="status">GST settings saved.</p>}
  {command.error?.code==='VERSION_CONFLICT'&&<button className="btn btn-text" onClick={()=>{command.reset();current.reload();}}>Load latest settings</button>}
  {blocked&&busy&&<p role="alert">Finish or retry this save before leaving.</p>}
 </section>;
}
