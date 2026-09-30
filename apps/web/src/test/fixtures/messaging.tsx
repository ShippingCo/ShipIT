// Fictional browser-only fixture. No real API, customer or provider traffic.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import Messaging from '../../operations/Messaging';
import {createScopeController} from '../../operator/scope';
import '../../styles/tokens.css';
import '../../styles/base.css';
import '../../styles/components.css';
import '../../operations/operations.css';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const controller=createScopeController();controller.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'franchise_admin'});
const states=['accepted','delivered','read','suppressed','failed','uncertain'];
const rows=states.map((state,n)=>({id:id(10+n),row_kind:'message',effective_time:'2026-09-29T12:00:00.000000Z',source_id:id(20+n),source_kind:'booking.created',affected_id:id(30+n),correlation_id:id(40+n),notification_kind:n===3?'delivery_otp':'booking_confirmation',decision:null,message:{id:id(10+n),state,reason_code:state==='accepted'?'provider_accepted':state,version:3,attempt_count:1,progress:state==='read'?'read':state==='delivered'?'delivered':'none',failure_observed:false,observed_at:null},fanout:null,recovery:{kind:state==='failed'?'redrive':state==='uncertain'?'investigate_uncertain':'none',expected_version:3,allowed_reasons:state==='failed'?['dependency_repaired']:state==='uncertain'?['retry_uncertain_confirmed']:[]},attempts:[],history_truncated:false,fanout_items:[],reminder:{eligible:false}}));
window.fetch=async(input,options)=>{
 const path=String(input);if(path==='/auth/bootstrap')return Response.json({csrf_token:'synthetic'});
 const url=new URL(path,window.location.origin),parts=url.pathname.split('/'),resource=parts.at(-1),row=rows.find(r=>r.id===resource);
 if(options?.method==='POST'&&resource==='redrive')return Response.json({id:parts.at(-2),version:4,state:'queued'});
 if(row)return Response.json(row);
 return Response.json({items:rows.filter(r=>!url.searchParams.get('status')||r.message.state===url.searchParams.get('status')),page:{has_more:false,next_cursor:null}});
};
createRoot(document.getElementById('root')!).render(<MemoryRouter><main style={{maxWidth:960,margin:'16px auto',padding:12}}><p>Fictional fixture — no customer/provider traffic</p><Messaging controller={controller} roles={['franchise_admin']}/></main></MemoryRouter>);
