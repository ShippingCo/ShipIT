import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import BookingPolicySetup,{policyAmount,policyRules} from '../operations/BookingPolicySetup';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
import {domesticCourierRows} from '../operations/DomesticCourierTemplate';
afterEach(()=>vi.unstubAllGlobals());
it('limits the courier template to confirmed selected courier services and never infers a customer jurisdiction',()=>{
 expect(()=>domesticCourierRows(['standard'],false)).toThrow();expect(()=>domesticCourierRows([],true)).toThrow();expect(()=>domesticCourierRows(['same_city'],true)).toThrow();expect(()=>domesticCourierRows(['standard','standard'],true)).toThrow();
 const rows=domesticCourierRows(['express'],true);expect(rows).toHaveLength(4);expect(new Set(rows.map(r=>r.registration+':'+r.jurisdiction))).toEqual(new Set(['registered:intra','registered:inter','unregistered:intra','unregistered:inter']));expect(rows.every(r=>r.service==='express'&&r.classification==='996812'&&r.percent==='18')).toBe(true);
});
it('converts exact prices and reviewed tax percentages without inventing a rate',()=>{
 expect(policyAmount('125.51')).toBe(12551);expect(()=>policyAmount('')).toThrow();expect(()=>policyAmount('0.001')).toThrow();
 expect(policyRules('pricing',[{destination:'MUMBAI',service:'standard',min:'1',max:'1000',freight:'125.51',packing:'2.49'}])).toEqual([{destination_key:'MUMBAI',service:'standard',min_weight_grams:1,max_weight_grams:1000,freight_paise:12551,packing_paise:249}]);
 const rules=policyRules('tax',[{service:'standard',registration:'unregistered',jurisdiction:'intra',classification:'REVIEWED',treatment:'taxable',evidence:'ADVICE_1',percent:'5',freight:'yes',packing:'no'}]);
 expect(rules[0]).toMatchObject({taxable_lines:['freight'],components:[{kind:'CGST',numerator:500,denominator:20000},{kind:'SGST',numerator:500,denominator:20000}]});
 expect(()=>policyRules('tax',[{treatment:'taxable',percent:''}])).toThrow();
});
it('requires review before publication and retries the same uncertain draft without duplicate intent',async()=>{
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'org_admin'});
 const calls:{path:string;options:RequestInit}[]=[],draft={id:f.id(80),version:1,state:'draft',effective_from:'2099-01-01T00:00:00.000Z',effective_to:'2099-02-01T00:00:00.000Z'};let lost=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(options.method==='POST'){calls.push({path,options});if(path.endsWith('/publish'))return f.json({...draft,state:'published'});if(lost){lost=false;throw new TypeError('lost response');}return f.json(draft,201);}
  return f.json({error:{code:path.includes('/tax/')?'TAX_POLICY_UNAVAILABLE':'NO_RATE'}},409);
 }));
 render(<><a href="/leave">Leave setup</a><BookingPolicySetup controller={controller} roles={['org_admin']}/></>);
 fireEvent.click(await screen.findByText('Rate card'));const area=screen.getByText('Rate card').closest('details')!,ui=within(area);
 fireEvent.change(ui.getByLabelText('Approval basis'),{target:{value:'external'}});fireEvent.change(ui.getByLabelText('Source basis'),{target:{value:'external'}});
 const guide=ui.getByText('What do these rate card fields mean?').closest('details')!;expect(guide).not.toHaveAttribute('open');fireEvent.click(ui.getByText('What do these rate card fields mean?'));expect(within(guide).getByText(/combined weight of its parcels/)).toBeVisible();expect(within(guide).getByText(/not a price per kg/)).toBeVisible();
 for(const [label,value] of [['Effective from','2099-01-01T00:00'],['Effective until','2099-02-01T00:00'],['Approval reference','REVIEW_1'],['Source reference','SHEET_1'],['Destination key','MUMBAI'],['Freight (₹)','125.51'],['Packing (₹)','2.49']])fireEvent.change(ui.getByLabelText(label),{target:{value}});
 fireEvent.click(ui.getByRole('button',{name:'Continue to prices'}));fireEvent.click(ui.getByRole('button',{name:'Save rate card draft'}));await ui.findByRole('button',{name:'Check if it saved'});
 expect(fireEvent.click(screen.getByRole('link',{name:'Leave setup'}))).toBe(false);expect(calls).toHaveLength(1);
 fireEvent.click(ui.getByRole('button',{name:'Check if it saved'}));await ui.findByRole('heading',{name:'Review saved rate card'});expect(ui.getByRole('heading',{name:'Review saved rate card'})).toHaveFocus();
 expect(calls).toHaveLength(2);expect(calls[1]!.options.body).toBe(calls[0]!.options.body);expect((calls[1]!.options.headers as Record<string,string>)['Idempotency-Key']).toBe((calls[0]!.options.headers as Record<string,string>)['Idempotency-Key']);
 expect(JSON.parse(String(calls[0]!.options.body))).toMatchObject({approval_ref:'REVIEW_1',source_ref:'SHEET_1'});
 expect(ui.getByRole('button',{name:'Publish rate card'})).toBeDisabled();fireEvent.click(ui.getByRole('checkbox',{name:'I reviewed the dates, rules and approval references.'}));fireEvent.click(ui.getByRole('button',{name:'Publish rate card'}));
 await waitFor(()=>expect(calls).toHaveLength(3));expect(JSON.parse(calls[2]!.options.body as string)).toEqual({expected_version:1});await ui.findByText(/Rate card published/);
});
it('does not fetch configuration or offer publication to an operator',()=>{
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'operator'});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 render(<BookingPolicySetup controller={controller} roles={['operator']}/>);expect(screen.queryByText('Rate card')).not.toBeInTheDocument();expect(fetcher).not.toHaveBeenCalled();
});
it('records transparent publisher-review and manual-entry provenance without fabricating document references',async()=>{
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'org_admin'});const writes:Record<string,unknown>[]=[];const draft={id:f.id(82),version:1,state:'draft',effective_from:'2099-01-01T00:00:00.000Z',effective_to:'2099-02-01T00:00:00.000Z'};
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});if(options.method==='POST'){writes.push(JSON.parse(String(options.body)));return f.json(draft,201);}return f.json({error:{code:path.includes('/tax/')?'TAX_POLICY_UNAVAILABLE':'NO_RATE'}},409);}));
 render(<BookingPolicySetup controller={controller} roles={['org_admin']}/>);fireEvent.click(await screen.findByText('Rate card'));const ui=within(screen.getByText('Rate card').closest('details')!);
 expect(ui.queryByLabelText('Approval reference')).not.toBeInTheDocument();expect(ui.queryByLabelText('Source reference')).not.toBeInTheDocument();expect(ui.getByLabelText('Review record summary')).toHaveTextContent('not an external document ID');expect(ui.getByLabelText('Freight (₹)')).toHaveValue('');expect(ui.getByLabelText('Packing (₹)')).toHaveValue('0');
 for(const [label,value] of [['Effective from','2099-01-01T00:00'],['Effective until','2099-02-01T00:00'],['Destination key','MUMBAI'],['Freight (₹)','100']])fireEvent.change(ui.getByLabelText(label),{target:{value}});
 fireEvent.click(ui.getByRole('button',{name:'Continue to prices'}));expect(ui.getByLabelText('Freight (₹)')).toBeVisible();fireEvent.click(ui.getByRole('button',{name:'Back to dates'}));expect(ui.getByLabelText('Effective from')).toHaveValue('2099-01-01T00:00');fireEvent.click(ui.getByRole('button',{name:'Continue to prices'}));fireEvent.submit(ui.getByRole('button',{name:'Save rate card draft'}).closest('form')!);await ui.findByRole('heading',{name:'Review saved rate card'});expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({approval_ref:'PUBLISHER_REVIEW',source_ref:'MANUAL_ENTRY',quote_validity_seconds:600,override_tolerance_paise:0,rules:[{freight_paise:10000,packing_paise:0}]});expect(ui.getByRole('button',{name:'Publish rate card'})).toBeDisabled();expect(ui.getByRole('checkbox',{name:'I reviewed the dates, rules and approval references.'})).not.toBeChecked();
});
