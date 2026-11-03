import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BusinessGstSettings} from '../operations/BusinessGstSettings';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
afterEach(()=>vi.unstubAllGlobals());
it('saves the demo GST preference in one step and retries a lost response with the same key and body',async()=>{
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'org_admin'});
 const writes:{body:string;key:string}[]=[];let saved=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(options.method==='POST'){writes.push({body:String(options.body),key:(options.headers as Record<string,string>)['Idempotency-Key']});if(writes.length===1)throw new TypeError('Lost response');saved=true;}
  return f.json({id:f.id(80),version:saved?3:2,mode:saved?'gta5':'courier18',supplier_state:'27'});
 }));
 render(<BusinessGstSettings controller={controller} roles={['org_admin']}/>);
 await waitFor(()=>expect(screen.getByLabelText('Business state')).toHaveValue('27'));
 expect(screen.getByLabelText('GST treatment')).toHaveValue('courier18');expect(screen.queryByRole('checkbox')).toBeNull();
 fireEvent.change(screen.getByLabelText('GST treatment'),{target:{value:'gta5'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
 fireEvent.click(await screen.findByRole('button',{name:'Retry same request'}));await screen.findByText('GST settings saved.');
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(JSON.parse(writes[0].body)).toEqual({mode:'gta5',supplier_state:'27',supplier_gstin:'',expected_version:2});
});
