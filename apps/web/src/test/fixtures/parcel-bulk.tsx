// Explicit synthetic browser regression fixture. Never imported by either app composition.
import React from 'react';
import { createRoot } from 'react-dom/client';
import type { BulkParcelItem,BulkParcelRequest,BulkParcelResult } from '@shippingco/shared';
import { createParcelBulkSource } from '../../data-access/parcel-bulk';
import { createParcelBulkController } from '../../data-access/parcel-bulk-controller';
import { createScopeController } from '../../operator/scope';
import { BulkParcelPanel } from '../../parcels/BulkParcelPanel';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/components.css';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const candidates=[1,2,3].map(n=>({label:`Parcel ${n}`,item:{parcel_id:id(n),idempotency_key:`synthetic-${n}`,
  command:{expected_version:1,evidence_ref:id(20),location_ref:id(21)}} as BulkParcelItem}));
const scope=createScopeController();scope.runtime.bind({userId:id(5),organizationId:id(6),franchiseId:id(7),permissions:'operator'});
let call=0;
const source=createParcelBulkSource({async request<T>(_path,options){
  const body=options!.body as BulkParcelRequest;
  document.getElementById('requests')!.textContent=body.items.map(item=>candidates.find(c=>c.item.parcel_id===item.parcel_id)!.label).join(', ');
  await new Promise(resolve=>setTimeout(resolve,500));
  const result:BulkParcelResult={action:body.action,items:body.items.map(item=>{
    if(call===0&&item.parcel_id!==id(1))return {parcel_id:item.parcel_id,outcome:'failed',error:{code:item.parcel_id===id(2)?'VERSION_CONFLICT':'RESOURCE_NOT_FOUND'}};
    return {parcel_id:item.parcel_id,outcome:'succeeded',result:{id:item.parcel_id,booking_id:id(8),docket:'SYN-1',version:item.command.expected_version+1,
      status:'checked_in',custody:'franchise_office',attempts_started:0,failed_attempt_count:0,event_id:id(9),transitioned_at:'2099-01-01T00:00:00Z'}};
  }),summary:{succeeded:call===0?1:body.items.length,failed:call===0?body.items.length-1:0}};
  call++;return result as T;
}});
const controller=createParcelBulkController(scope,source);
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:640,margin:'16px auto',padding:8}}>
  <h1>Synthetic bulk command regression</h1><p>Fictional fixture. No API or provider requests.</p>
  <BulkParcelPanel controller={controller} action="check_in" candidates={candidates}
    refreshFailed={async failed=>failed.map(item=>({...item,command:{...item.command,expected_version:2}}))}/>
  <p>Last submitted: <output id="requests"/></p>
</main>);
