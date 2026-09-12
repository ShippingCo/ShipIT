import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OperatorContext } from '@shippingco/shared';
import App from '../App';
import { createScopeController } from '../operator/scope';
import { OperatorError } from '../operator/api';

const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const user='00000000-0000-4000-8000-000000000003';
const franchise=(id:string,name:string)=>({id,display_name:name,organization:{id:'synthetic-org',display_name:'Synthetic shop'},roles:['org_admin' as const]});
const ready:OperatorContext={user_id:user,state:'ready',active_franchise_id:A,franchises:[franchise(A,'Counter A'),franchise(B,'Counter B')]};
const empty:OperatorContext={user_id:user,state:'onboarding_required',active_franchise_id:null,franchises:[]};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
let context=empty;
let calls:{path:string;options:RequestInit}[]=[];
let responseOverride:((path:string,options:RequestInit)=>Promise<Response>|undefined)|undefined;
beforeEach(()=>{
  window.location.hash='/';sessionStorage.clear();context=empty;calls=[];responseOverride=undefined;
  vi.stubEnv('VITE_DATA_MODE','production');
  vi.stubGlobal('fetch',vi.fn(async (path:string,options:RequestInit={})=>{
    calls.push({path,options});const override=responseOverride?.(path,options);if(override)return override;
    if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
    if(path.startsWith('/api/v1/operator-context'))return json({...context,active_franchise_id:path.endsWith(B)?B:context.active_franchise_id});
    if(path==='/api/v1/onboarding'){context=ready;return json({role:'org_admin'},201);}
    if(path==='/api/v1/membership-invitations/accept'){context=ready;return json({},201);}
    if(path==='/auth/logout')return json({ok:true});
    if(path==='/auth/challenges')return json({challenge_id:'synthetic-challenge'});
    if(path==='/auth/challenges/verify'){context=empty;return json({authenticated:true});}
    throw new Error('Unexpected synthetic request');
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fill() {
  await screen.findByRole('heading',{name:'Set up your shop'});
  fireEvent.change(screen.getByLabelText('Business name'),{target:{value:'Synthetic shop'}});
  fireEvent.change(screen.getByLabelText('Location name'),{target:{value:'Counter A'}});
  fireEvent.change(screen.getByLabelText('Location code'),{target:{value:'MAIN'}});
}

describe('production operator flow',()=>{
  it('completes onboarding, sends only approved fields and reloads server context without browser authority',async()=>{
    const view=render(<App/>);await fill();
    fireEvent.click(screen.getByRole('button',{name:'Create workspace'}));
    await screen.findByRole('heading',{name:'Counter A'});
    const command=calls.find(c=>c.path==='/api/v1/onboarding')!;
    expect(JSON.parse(command.options.body as string)).toEqual({display_name:'Synthetic shop',franchise:{display_name:'Counter A',franchise_code:'MAIN'}});
    expect((command.options.headers as Record<string,string>)['Idempotency-Key']).toBeTruthy();
    expect(screen.queryByText('Parcels moving')).not.toBeInTheDocument();
    view.unmount();sessionStorage.clear();localStorage.clear();render(<App/>);
    await screen.findByRole('heading',{name:'Counter A'});
    expect(calls.filter(c=>c.path==='/api/v1/onboarding')).toHaveLength(1);
    expect(screen.getByRole('heading',{name:'Counter A'})).toHaveFocus();
  });
  it('associates required validation with focusable inputs and completes a form submit',async()=>{
    render(<App/>);await screen.findByRole('button',{name:'Create workspace'});
    fireEvent.click(screen.getByRole('button',{name:'Create workspace'}));
    const input=screen.getByLabelText('Business name');expect(input).toHaveFocus();expect(input).toHaveAttribute('aria-invalid','true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('Enter a business name');
    expect(screen.getByLabelText('Location code')).toHaveAccessibleDescription('Start with A–Z; use up to 32 capital letters, digits or underscores.');
    expect(calls.some(c=>c.path==='/api/v1/onboarding')).toBe(false);
    await fill();fireEvent.submit(screen.getByRole('button',{name:'Create workspace'}).closest('form')!);
    await screen.findByRole('heading',{name:'Counter A'});
  });
  it('lists only server scopes and clears the old shell immediately while switching',async()=>{
    context=ready;const slow=deferred<Response>();responseOverride=path=>path.endsWith(B)?slow.promise:undefined;
    render(<App/>);await screen.findByRole('heading',{name:'Counter A'});
    const options=screen.getAllByRole('option');expect(options).toHaveLength(2);expect(options.map(option=>(option as HTMLOptionElement).value)).toEqual([A,B]);
    fireEvent.change(screen.getByLabelText('Franchise'),{target:{value:B}});
    expect(screen.queryByRole('heading',{name:'Counter A'})).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking workspace access');
    await act(async()=>slow.resolve(json({...ready,active_franchise_id:B})));
    await screen.findByRole('heading',{name:'Counter B'});
  });
  it('late A response cannot paint after B, even when transport ignores cancellation',async()=>{
    context=ready;const controller=createScopeController();await controller.load(A);
    const old=deferred<string>();let painted='';
    const pending=controller.run(()=>old.promise,value=>{painted=value;});
    await controller.load(B);await controller.run(async()=>'B private data',value=>{painted=value;});
    old.resolve('A private data');await pending;
    expect(painted).toBe('B private data');expect(controller.snapshot().context?.active_franchise_id).toBe(B);
    const stale=deferred<Response>();responseOverride=path=>path.endsWith(A)?stale.promise:undefined;
    const a=controller.load(A);await controller.load(B);stale.resolve(json(ready));await a;
    expect(controller.snapshot().context?.active_franchise_id).toBe(B);
  });
  it('protected navigation after revocation removes cached data and offers controlled recovery',async()=>{
    context=ready;render(<App/>);await screen.findByRole('heading',{name:'Counter A'});
    responseOverride=path=>path.startsWith('/api/v1/operator-context')?Promise.resolve(json({error:{code:'RESOURCE_NOT_FOUND'}},404)):undefined;
    fireEvent.click(screen.getAllByRole('link',{name:'Settings'})[0]);
    await screen.findByRole('heading',{name:'Workspace access unavailable'});
    expect(screen.queryByRole('heading',{name:'Counter A'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Franchise')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Private workspace data has been cleared');
    responseOverride=undefined;context={...empty,state:'scope_unavailable'};
    fireEvent.click(screen.getAllByRole('button',{name:'Refresh workspace access'})[0]);
    await screen.findByRole('heading',{name:'No available workspace'});
    expect(screen.queryByRole('button',{name:'Create workspace'})).not.toBeInTheDocument();
  });
  it('a denied scoped action clears context and a late previous request cannot restore it',async()=>{
    context=ready;const controller=createScopeController();await controller.load(A);
    const late=deferred<string>();let painted=false;const pending=controller.run(()=>late.promise,()=>{painted=true;});
    await controller.run(()=>Promise.reject(new OperatorError('ACTION_FORBIDDEN')),()=>{});
    late.resolve('old');await pending;expect(painted).toBe(false);expect(controller.snapshot().context).toBeNull();
  });
  it('uncertain onboarding preserves the exact request key and body over remount',async()=>{
    responseOverride=path=>path==='/api/v1/onboarding'?Promise.reject(new TypeError('Network failure')):undefined;
    const view=render(<App/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Create workspace'}));
    await screen.findByRole('alert');const first=calls.find(c=>c.path==='/api/v1/onboarding')!;view.unmount();
    responseOverride=undefined;render(<App/>);await screen.findByRole('button',{name:'Retry same request'});
    fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await screen.findByRole('heading',{name:'Counter A'});
    const last=calls.filter(c=>c.path==='/api/v1/onboarding').at(-1)!;
    expect(last.options.body).toBe(first.options.body);expect(last.options.headers).toEqual(first.options.headers);
  });
  it('committed onboarding followed by context failure recovers from server state without a second create',async()=>{
    let committed=false;
    responseOverride=path=>{
      if(path==='/api/v1/onboarding'){committed=true;context=ready;return Promise.resolve(json({},201));}
      if(committed&&path.startsWith('/api/v1/operator-context'))return Promise.resolve(json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503));
    };
    render(<App/>);await fill();fireEvent.click(screen.getByRole('button',{name:'Create workspace'}));
    await screen.findByRole('heading',{name:'Workspace access unavailable'});responseOverride=undefined;
    fireEvent.click(screen.getAllByRole('button',{name:'Refresh workspace access'})[0]);await screen.findByRole('heading',{name:'Counter A'});
    expect(calls.filter(c=>c.path==='/api/v1/onboarding')).toHaveLength(1);
  });
  it('accepts through the existing invitation API and never stores the secret',async()=>{
    render(<App/>);await screen.findByRole('heading',{name:'Set up your shop'});
    fireEvent.change(screen.getByLabelText('Invitation code'),{target:{value:'synthetic-invitation-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));await screen.findByRole('heading',{name:'Counter A'});
    expect(calls.find(c=>c.path==='/api/v1/membership-invitations/accept')?.options.body).toBe(JSON.stringify({token:'synthetic-invitation-secret'}));
    expect(JSON.stringify(sessionStorage)+JSON.stringify(localStorage)).not.toContain('synthetic-invitation-secret');
    expect(screen.getByLabelText('Invitation code')).toHaveValue('');
  });
  it('an invitation response after navigation refreshes the current route instead of stranding loading',async()=>{
    const accepting=deferred<Response>();
    responseOverride=path=>path.endsWith('/accept')?accepting.promise:undefined;
    render(<App/>);await screen.findByRole('heading',{name:'Set up your shop'});
    fireEvent.change(screen.getByLabelText('Invitation code'),{target:{value:'synthetic-invitation-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));
    await act(async()=>{window.location.hash='/business/settings';});
    await screen.findByRole('heading',{name:'Set up your shop'});
    context=ready;await act(async()=>accepting.resolve(json({},201)));
    await screen.findByRole('heading',{name:'Counter A'});
    expect(document.querySelector('.appbar-title')).toHaveTextContent('Settings');
    expect(screen.queryByText('Checking workspace access…')).not.toBeInTheDocument();
  });
  it('failed invitation acceptance preserves controlled recovery',async()=>{
    responseOverride=path=>path.endsWith('/accept')?Promise.resolve(json({error:{code:'ACTION_FORBIDDEN'}},403)):undefined;
    render(<App/>);await screen.findByRole('heading',{name:'Set up your shop'});
    fireEvent.change(screen.getByLabelText('Invitation code'),{target:{value:'expired-secret'}});fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));
    await screen.findByText(/Invitation could not be confirmed/);expect(screen.getByLabelText('Invitation code')).toHaveValue('');
  });
  it('authenticates through existing challenge routes and safely signs out',async()=>{
    let signedIn=false;
    responseOverride=path=>{
      if(path==='/auth/challenges/verify'){signedIn=true;context=ready;return Promise.resolve(json({authenticated:true}));}
      if(path.startsWith('/api/v1/operator-context')&&!signedIn)return Promise.resolve(json({error:{code:'UNAUTHENTICATED'}},401));
    };
    render(<App/>);await screen.findByRole('heading',{name:'Sign in to ShippingCo'});
    fireEvent.change(screen.getByLabelText('Email'),{target:{value:'operator@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Send sign-in code'}));
    await screen.findByLabelText('Sign-in code');fireEvent.change(screen.getByLabelText('Sign-in code'),{target:{value:'12345678'}});
    fireEvent.click(screen.getByRole('button',{name:'Verify and continue'}));await screen.findByRole('heading',{name:'Counter A'});
    fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByRole('heading',{name:'Sign in to ShippingCo'});
    expect(screen.queryByRole('heading',{name:'Counter A'})).not.toBeInTheDocument();
  });
  it('does not fall back to localStorage on an API outage',async()=>{
    localStorage.setItem('shippingco_v1',JSON.stringify({business:{name:'Forbidden cached shop'}}));
    responseOverride=()=>Promise.reject(new TypeError('Network failure'));render(<App/>);
    await screen.findByRole('heading',{name:'Workspace access unavailable'});expect(screen.queryByText('Forbidden cached shop')).not.toBeInTheDocument();
    await waitFor(()=>expect(screen.queryByText('Reset demo data')).not.toBeInTheDocument());
  });
});
