import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {AccountStatement,CustomerAccountDto} from '@shippingco/shared';
import {statementMeasures} from '@shippingco/shared';
import {AccountStatements} from '../operations/AccountStatements';
import {accountStatement} from '../data-access/account-statements';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
const amounts={opening:'0',charges:'10000',credits:'0',payments:'500',refunds:'0',closing:'9500',outstanding:'9500',refundable_credit:'0'};
const statement:AccountStatement={id:null,kind:'account_statement_v2',account_id:f.id(70),account_revision_id:f.id(71),account_name:'Fictional account',customer_id:f.customerId,from_day:'2099-01-01',to_day:'2099-01-31',as_of:f.now,version:1,previous_statement_id:null,source_digest:'a'.repeat(64),unallocated_advance:'200',advance_sources:[{receipt_id:f.id(40),version:1,received:'700',allocated:'500',cod_reserved:'0',unallocated:'200'}],totals:amounts,lines:[{booking_id:f.bookingId,due_date:'2099-02-10',confirmed_at:f.now,source_statement_id:null,payment_version:1,financial_version:0,receipt_id:null,original_gross:'10000',pre_tax:'10000',cgst:'0',sgst:'0',igst:'0',rounding:'0',payment_ids:[f.id(30)],adjustment_ids:[],payment_evidence:[{id:f.id(30),kind:'collection',amount:'500',recorded_at:f.now}],adjustment_evidence:[],amounts}]};
const account:CustomerAccountDto={id:f.id(70),revision_id:f.id(71),version:1,debtor_customer_id:f.customerId,name:'Fictional account',shipping_customer_ids:[f.customerId],billing_contact:{name:'Fictional Contact',phone:'+12025550100',authorization_ref:'SYNTHETIC'},closing_day:31,due_days:10,credit_limit_paise:100000,state:'active',recorded_at:f.now};
let calls:{path:string;options:RequestInit}[],lost:boolean;
beforeEach(()=>{calls=[];lost=false;vi.stubEnv('VITE_DATA_MODE','production');vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
 calls.push({path,options});if(path==='/auth/bootstrap')return f.json({csrf_token:'SYN-CSRF'});if(path.includes('/operator-context'))return f.json(f.context);
 if(path.includes('/statements?'))return f.json({items:[],next_cursor:null});
 if(path.includes('/preview?'))return f.json(statement);
 if(path.startsWith('/api/v1/account-statements?')){if(lost){lost=false;throw new TypeError('SYN_ACK_LOST');}return f.json({...statement,id:f.id(80)});}
 throw new Error('Unexpected synthetic statement request');
}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function start(admin=true){const controller=createScopeController();await controller.load();const busy=vi.fn();render(<MemoryRouter><AccountStatements api={scopedApi(controller)} account={account} admin={admin} busyChanged={busy}/></MemoryRouter>);return {controller,busy};}
const fill=()=>{fireEvent.change(screen.getByLabelText('Period start'),{target:{value:'2099-01-01'}});fireEvent.change(screen.getByLabelText('Period end'),{target:{value:'2099-01-31'}});fireEvent.click(screen.getByRole('button',{name:'Preview statement'}));};
it('shows independently checked balances, source debt, private history and exact uncertain issue recovery',async()=>{
 const {busy}=await start();await screen.findByText('No issued statements');fill();await screen.findByRole('button',{name:'Issue statement'});expect(screen.getByText(/Opening ₹0.00/)).toHaveTextContent('closing ₹95.00');expect(screen.getByText(/Unallocated customer advance/)).toHaveTextContent('₹2.00');
 lost=true;fireEvent.click(screen.getByRole('button',{name:'Issue statement'}));await screen.findByRole('button',{name:'Retry same request'});expect(screen.getByLabelText('Period start')).toBeDisabled();expect(busy).toHaveBeenLastCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByRole('button',{name:'Capture private CSV'});const issues=calls.filter(c=>c.path.startsWith('/api/v1/account-statements?'));expect(issues).toHaveLength(2);expect(issues[1]!.options.body).toBe(issues[0]!.options.body);expect(issues[1]!.options.headers).toEqual(issues[0]!.options.headers);await waitFor(()=>expect(busy).toHaveBeenLastCalledWith(false));
 expect(screen.getByRole('link',{name:'Record or allocate customer payment'})).toHaveAttribute('href','/business/money-receipts?customer_id='+f.customerId);
});
it('allows accountant preview with no issuing action and rejects unreconciled DTO totals',async()=>{
 await start(false);fill();await screen.findByText(/Preview ready/);expect(screen.queryByRole('button',{name:'Issue statement'})).not.toBeInTheDocument();
 expect(()=>accountStatement({...statement,totals:{...amounts,closing:'9501'}})).toThrow();
 const bad=structuredClone(statement);bad.lines[0]!.amounts.payments='501';expect(()=>accountStatement(bad)).toThrow();
 expect(statementMeasures.every(k=>typeof accountStatement(statement).totals[k]==='string')).toBe(true);
});
