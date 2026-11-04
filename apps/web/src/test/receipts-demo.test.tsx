import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Receipts from '../booking/Receipts';
import {createScopeController} from '../operator/scope';
import type {OperatorDataSource} from '../operator/data-source';
import {counterReceiptView} from '../utils/counter-receipt';
import * as f from './counter-fixture';
const entry={id:f.id(301),state:'confirmed' as const,organization_id:f.org,franchise_id:f.A,confirmed_at:f.now,data:{fields:{name:'Saved recipient',phone:'+919876543210',docket:'REAL-RCT',destination:'Mumbai',weight:'1000',service:'standard',packing:'2000',override:'2000',paymentMode:'paid_counter'},additional_parcels:[]}};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
 if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[entry]});
 if(path.startsWith('/api/v1/parcels?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
 throw Error('Unexpected read');
})));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function start(){const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();render(<MemoryRouter><Receipts controller={controller} roles={['org_admin']}/></MemoryRouter>);await screen.findByText('REAL-RCT');}
it('uses demo columns, search, date filter, count and actual total',async()=>{
 await start();for(const name of ['Docket','Customer','Total','Payment','Booked'])expect(screen.getByRole('columnheader',{name})).toBeVisible();
 expect(screen.getByRole('textbox',{name:'Search receipts'})).toHaveAttribute('placeholder','Search docket, name or phone');expect(screen.getByRole('button',{name:'All time'})).toBeVisible();expect(screen.getByText('1 receipt · ₹40')).toBeVisible();expect(screen.getByText('Not recorded')).toBeVisible();expect(screen.getByRole('button',{name:'Reprint REAL-RCT'})).toBeVisible();
});
it('searches phone and clears unmatched filters',async()=>{
 await start();const search=screen.getByRole('textbox',{name:'Search receipts'});fireEvent.change(search,{target:{value:'987654'}});expect(screen.getByText('REAL-RCT')).toBeVisible();fireEvent.change(search,{target:{value:'unknown'}});expect(screen.getByText('No receipts match')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(screen.getByText('REAL-RCT')).toBeVisible();
});
it('prints the shared receipt sheet only on Reprint and cleans private print DOM',async()=>{
 const print=vi.spyOn(window,'print').mockImplementation(()=>{
 const root=document.getElementById('print-root')!;expect(root.querySelector('.receipt-sheet')).not.toBeNull();for(const value of ['REAL-RCT','Saved recipient','Standard · 1 kg','Packing charges₹20','Taxable value—','Entered total₹40'])expect(root.textContent).toContain(value);expect(root.textContent).not.toContain('Fictional demo');
 });await start();expect(print).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Reprint REAL-RCT'}));await waitFor(()=>expect(print).toHaveBeenCalledOnce());expect(document.getElementById('print-root')).toBeNull();expect(document.body).not.toHaveClass('printing');
});
it('keeps missing values and payment truthful',()=>{
 const view=counterReceiptView({...entry,data:{fields:{},additional_parcels:[]}},'Saved business');expect(view.issuer).toBe('Saved business');expect(view.total).toBe('—');expect(view.rows.find(([label])=>label==='CGST')?.[1]).toBe('—');expect(view.note).toContain('payment are not recorded');
});
