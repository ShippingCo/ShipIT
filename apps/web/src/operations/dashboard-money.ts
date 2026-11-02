import {useEffect,useMemo,useRef,useState} from 'react';
import type {AgeingSnapshot} from '@shippingco/shared';
import {ageing} from '../data-access/ageing';
import {scopedApi} from '../data-access/scoped-api';
import type {ScopeController} from '../operator/scope';
import {useCommand} from './hooks';

/** Reuses the accounting report's exact corrections, booking scope and bucket rules. */
export function useDashboardMoney(controller:ScopeController,enabled:boolean) {
  const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>ageing(api),[api]);
  const command=useCommand(source.execute),[snapshot,setSnapshot]=useState<AgeingSnapshot|null>(null),[error,setError]=useState(false);
  const active=useRef(true),busy=useRef(false);
  async function load() {
    if(!enabled||busy.current)return;busy.current=true;setError(false);
    try {
      const result=await(command.canRetry?command.retry():command.run(source.intent({anchor:'booking',status:'delivered',customer_id:null,balances:'outstanding'})));
      if(result&&(result.snapshot.filter.anchor!=='booking'||result.snapshot.filter.status!=='delivered'||result.snapshot.filter.balances!=='outstanding'||result.snapshot.filter.customer_id!==null))throw new Error('Unexpected report filter');
      if(active.current&&controller.runtime.isCurrent(api.scope)&&result)setSnapshot(result.snapshot);
    } catch {if(active.current&&controller.runtime.isCurrent(api.scope)){setSnapshot(null);setError(true);}}
    finally {busy.current=false;}
  }
  // Keep initial capture stable through StrictMode replay; uncertain outcomes retain
  // useCommand's original idempotency intent for the explicit Retry action.
  const loader=useRef(load);loader.current=load;
  useEffect(()=>{active.current=true;if(enabled)void loader.current();return()=>{active.current=false;};},[enabled]);
  return {snapshot,error,busy:command.phase==='pending',reload:()=>{void load();}};
}
