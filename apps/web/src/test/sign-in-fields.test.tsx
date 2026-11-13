import {expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import SignIn from '../operator/SignIn';
import {createOperatorDataSource} from '../operator/data-source';
import {ApiFailure} from '../data-access/errors';
import * as f from './counter-fixture';

const CODE='Your 8-digit code';

function phone(value='9876543210') {
 fireEvent.change(screen.getByLabelText('Phone number'),{target:{value}});
}

it('sends the code on WhatsApp to the number as dialled and keeps it on refusal',async()=>{
 const source={...createOperatorDataSource(),
  startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'})),
  verifySignIn:vi.fn(async()=>{throw new ApiFailure('UNAUTHENTICATED',{status:401});})},complete=vi.fn();
 render(<SignIn source={source} complete={complete}/>);
 // A number written the way it is written down locally still reads as ten digits.
 phone('098765 43210');
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with a phone number'}));
 expect(source.startSignIn).toHaveBeenCalledWith('whatsapp','+919876543210',expect.any(AbortSignal));
 await waitFor(()=>expect(screen.getByLabelText(CODE)).toHaveFocus());
 expect(screen.getByText('+91 98765 43210')).toBeVisible();
 fireEvent.change(screen.getByLabelText(CODE),{target:{value:'00123456'}});
 // The eighth digit submits on its own; the code is kept out of the field after a refusal.
 await screen.findByRole('alert');
 expect(source.verifySignIn).toHaveBeenCalledWith('synthetic-challenge','00123456',expect.any(AbortSignal));
 expect(screen.getByLabelText(CODE)).toHaveValue('');
 expect(screen.getByLabelText(CODE)).toHaveAttribute('aria-invalid','true');
 expect(screen.getByRole('alert')).toHaveTextContent('That code did not work. Check the 8 digits and try again.');
 expect(complete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Change'}));
 expect(screen.getByLabelText('Phone number')).toHaveValue('098765 43210');
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('names a mistyped number on blur without clearing it',()=>{
 render(<SignIn source={createOperatorDataSource()} complete={vi.fn(async()=>{})}/>);
 phone('98765432');
 fireEvent.blur(screen.getByLabelText('Phone number'));
 expect(screen.getByRole('alert')).toHaveTextContent('A phone number is 10 digits. This one has 8.');
 expect(screen.getByLabelText('Phone number')).toHaveValue('98765432');
});

it('says nothing could be reached when the network fails, and clears nothing',async()=>{
 const source={...createOperatorDataSource(),
  startSignIn:vi.fn(async()=>{throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network'});})};
 render(<SignIn source={source} complete={vi.fn(async()=>{})}/>);
 phone();
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with a phone number'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach ShipIT. Check the shop’s internet and try again.');
 expect(screen.getByLabelText('Phone number')).toHaveValue('9876543210');
});

it('states a wait after three wrong codes and never locks the account',async()=>{
 const source={...createOperatorDataSource(),
  startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'})),
  verifySignIn:vi.fn(async()=>{throw new ApiFailure('UNAUTHENTICATED',{status:401});})};
 render(<SignIn source={source} complete={vi.fn(async()=>{})}/>);
 phone();
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with a phone number'}));
 await screen.findByLabelText(CODE);
 for(const code of ['11111111','22222222','33333333']) {
  fireEvent.change(screen.getByLabelText(CODE),{target:{value:code}});
  await screen.findByRole('alert');
 }
 const wait=await screen.findByText(/Try again in \d+s\. Your account is not locked\./);
 expect(wait).toBeVisible();
 expect(source.verifySignIn).toHaveBeenCalledTimes(3);
 // Nothing is accepted during the stated wait, and nothing is sent either.
 fireEvent.change(screen.getByLabelText(CODE),{target:{value:'44444444'}});
 expect(source.verifySignIn).toHaveBeenCalledTimes(3);
});

it('preserves leading zeroes and ignores a verification completed after unmount',async()=>{
 const pending=f.deferred<unknown>(),verify=vi.fn((_challenge:string,_code:string,_signal?:AbortSignal)=>pending.promise);
 const source={...createOperatorDataSource(),startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'})),verifySignIn:verify},complete=vi.fn();
 const view=render(<SignIn source={source} complete={complete}/>);
 phone();
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with a phone number'}));
 await screen.findByLabelText(CODE);
 fireEvent.change(screen.getByLabelText(CODE),{target:{value:'00123456'}});
 expect(verify).toHaveBeenCalledWith('synthetic-challenge','00123456',expect.any(AbortSignal));
 expect(screen.getByRole('button',{name:'Checking the code…'})).toBeDisabled();
 view.unmount();expect(verify.mock.calls[0]![2]!.aborted).toBe(true);
 await act(async()=>pending.resolve({}));
 expect(complete).not.toHaveBeenCalled();
});

it('reuses the challenge for another code and clears the countdown on change',async()=>{
 const source={...createOperatorDataSource(),
   startSignIn:vi.fn(async()=>({challenge_id:'test-challenge',resend_after:1})),
   resendSignIn:vi.fn(async()=>({resend_after:60}))};
 render(<SignIn source={source} complete={vi.fn(async()=>{})}/>);
 phone();
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with a phone number'}));
 expect(await screen.findByRole('button',{name:'Another code in 1s'})).toBeDisabled();
 const retry=await screen.findByRole('button',{name:'Send another code'},{timeout:4000});
 fireEvent.click(retry);
 expect(await screen.findByText('Another code is on its way to +91 98765 43210.')).toBeVisible();
 expect(source.resendSignIn).toHaveBeenCalledWith('test-challenge',expect.any(AbortSignal));
 expect(source.startSignIn).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:/Another code in/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Change'}));
 expect(screen.getByLabelText('Phone number')).toHaveValue('9876543210');
 expect(screen.queryByText(/Another code is on its way/)).not.toBeInTheDocument();
});

it('still offers an email address for a shop enrolled that way',async()=>{
 const source={...createOperatorDataSource(),startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'}))};
 render(<SignIn source={source} complete={vi.fn(async()=>{})}/>);
 fireEvent.click(screen.getByRole('button',{name:'Use an email address instead'}));
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'operator@example.test'}});
 fireEvent.submit(screen.getByRole('form',{name:'Sign in with an email address'}));
 expect(source.startSignIn).toHaveBeenCalledWith('email','operator@example.test',expect.any(AbortSignal));
 await screen.findByLabelText(CODE);
 expect(screen.getByText('operator@example.test')).toBeVisible();
});
