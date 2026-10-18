import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import type {AdvanceRefundCommand} from '@shippingco/shared';
import {AdvanceRefunds} from '../operations/AdvanceRefunds';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
import {moneyReceiptResult} from '../data-access/money-receipts';
import {accountNavigationPending} from '../data-access/account-navigation';
import * as f from './counter-fixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('requires independent review and actual evidence, retaining an uncertain return exactly; finance readers cannot write',async()=>{
 const receipt=f.id(90),root:AdvanceRefundCommand={id:f.id(91),request_id:f.id(91),receipt_id:receipt,version:1,operation:'request',actor_id:f.id(92),recorded_at:new Date(Date.now()-1000).toISOString(),amount_paise:600,input:{expected_receipt_version:1,amount_paise:600,reason:'Unused customer advance'}};
 const events=[root],writes:{body:string;headers:HeadersInit|undefined}[]=[];let lose=true;
 const balance={receipt_id:receipt,customer_id:f.customerId,version:1,currency:'INR',received_paise:1000,allocated_paise:0,unallocated_paise:1000,allocations:[]};
 vi.stubEnv('VITE_DATA_MODE','production');vi.stubGlobal('fetch',vi.fn(async(path:string,o:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'SYN-CSRF'});if(path.includes('/operator-context'))return f.json(f.context);
  if(o.method==='POST'){const input=JSON.parse(String(o.body)),operation=path.includes('/approve?')?'approve':'return';writes.push({body:String(o.body),headers:o.headers});let result=events.find(c=>c.operation===operation);
   if(!result){result={...root,id:f.id(operation==='approve'?93:94),version:operation==='approve'?2:3,operation,actor_id:f.context.user_id,input};events.push(result);}
   if(operation==='return'&&lose){lose=false;throw new TypeError('SYN_ACK_LOST');}return f.json(result);
  }
  if(path.includes('/advance-refunds?'))return f.json({items:events,next_cursor:null});
  if(path.includes('/balance?'))return f.json(balance);
  if(path.includes('/cashbook/locations?'))return f.json({items:[{id:f.id(95),revision_id:f.id(96),version:1,name:'Fictional return account',active:true,kind:'noncash',account_id:f.id(97),account_revision_id:f.id(98),account_version:1,methods:['bank_transfer'],custodian_id:null,recorded_at:f.now}],next_cursor:null});
  throw new Error('Unexpected advance refund request');
 }));
 const controller=createScopeController();await controller.load();const busy=vi.fn(),refreshed=vi.fn(),props={api:scopedApi(controller),receipt,roles:['franchise_admin'] as const,self:f.context.user_id,parentLocked:false,busyChanged:busy,refreshed};
 const view=render(<AdvanceRefunds {...props}/>);await screen.findByRole('button',{name:'Approve advance refund'});expect(screen.getByRole('button',{name:'Approve advance refund'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/^Advance refund reason/),{target:{value:'Independently checked return'}});fireEvent.click(screen.getByRole('button',{name:'Approve advance refund'}));await screen.findByRole('button',{name:'Record actual advance return'});expect(screen.getByRole('button',{name:'Record actual advance return'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/^Refund source location/),{target:{value:f.id(95)}});fireEvent.change(screen.getByLabelText(/^Private advance return reference/),{target:{value:'SYN_ACTUAL_RETURN'}});fireEvent.click(screen.getByRole('button',{name:'Use current return time'}));
 expect(screen.getByRole('button',{name:'Record actual advance return'})).toBeDisabled();fireEvent.change(screen.getByLabelText(/^Returned to \/ customer acknowledgement reference/),{target:{value:'SYN_CUSTOMER_ACK'}});
 fireEvent.click(screen.getByRole('button',{name:'Record actual advance return'}));await screen.findByRole('button',{name:'Retry same request'});expect(screen.getByLabelText(/^Advance refund reason/)).toBeDisabled();expect(busy).toHaveBeenLastCalledWith(true);expect(accountNavigationPending(props.api.scope)).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await waitFor(()=>expect(busy).toHaveBeenLastCalledWith(false));expect(writes).toHaveLength(3);expect(writes[2]).toEqual(writes[1]);expect(screen.queryByRole('button',{name:'Record actual advance return'})).toBeNull();
 expect(accountNavigationPending(props.api.scope)).toBe(false);view.rerender(<AdvanceRefunds {...props} roles={['accountant']}/>);expect(screen.queryByRole('button',{name:'Request unused advance refund'})).toBeNull();expect(screen.queryByRole('button',{name:'Approve advance refund'})).toBeNull();expect(screen.queryByLabelText(/^Private advance return reference/)).toBeNull();
 expect(moneyReceiptResult({...balance,returned_paise:600,unallocated_paise:400}).unallocated_paise).toBe(400);expect(()=>moneyReceiptResult({...balance,returned_paise:600})).toThrow();
});
