import {expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import SignIn from '../operator/SignIn';
import {createOperatorDataSource} from '../operator/data-source';
import * as f from './counter-fixture';

it('focuses sign-in steps and retains the email while clearing a rejected code',async()=>{
 const source={...createOperatorDataSource(),startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'})),verifySignIn:vi.fn(async()=>{throw new Error('invalid code');})},complete=vi.fn();
 render(<SignIn source={source} complete={complete}/>);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'operator@example.test'}});fireEvent.submit(screen.getByRole('form',{name:'Sign in with email'}));
 await waitFor(()=>expect(screen.getByLabelText('Sign-in code')).toHaveFocus());fireEvent.change(screen.getByLabelText('Sign-in code'),{target:{value:'00123456'}});fireEvent.submit(screen.getByRole('form',{name:'Verify sign-in code'}));
 await screen.findByRole('alert');expect(screen.getByLabelText('Sign-in code')).toHaveValue('');expect(screen.getByLabelText('Sign-in code')).toHaveAttribute('aria-invalid','true');expect(screen.getByLabelText('Sign-in code')).toHaveAccessibleDescription(/Sign-in could not be completed/);expect(complete).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Use email again'}));expect(screen.getByLabelText('Email')).toHaveValue('operator@example.test');expect(screen.getByLabelText('Email')).toHaveFocus();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('preserves leading zeroes in a sign-in code and ignores a verification completed after unmount',async()=>{
 const pending=f.deferred<unknown>(),verify=vi.fn((_challenge:string,_code:string,_signal?:AbortSignal)=>pending.promise),source={...createOperatorDataSource(),startSignIn:vi.fn(async()=>({challenge_id:'synthetic-challenge'})),verifySignIn:verify},complete=vi.fn();
 const view=render(<SignIn source={source} complete={complete}/>);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'operator@example.test'}});fireEvent.submit(screen.getByRole('form',{name:'Sign in with email'}));
 await screen.findByLabelText('Sign-in code');fireEvent.change(screen.getByLabelText('Sign-in code'),{target:{value:'00123456'}});fireEvent.submit(screen.getByRole('form',{name:'Verify sign-in code'}));
 expect(verify).toHaveBeenCalledWith('synthetic-challenge','00123456',expect.any(AbortSignal));expect(screen.getByRole('button',{name:'Checking code…'})).toBeDisabled();view.unmount();expect(verify.mock.calls[0]![2]!.aborted).toBe(true);await act(async()=>pending.resolve({}));expect(complete).not.toHaveBeenCalled();
});

it('reuses the email challenge for resend and clears the cooldown when returning to email',async()=>{
 const source={...createOperatorDataSource(),startSignIn:vi.fn(async()=>({challenge_id:'test-challenge',resend_after:1})),
   resendSignIn:vi.fn(async()=>({resend_after:60}))};
 render(<SignIn source={source} complete={vi.fn(async()=>{})}/>);
 fireEvent.click(screen.getByRole('button',{name:'Set up your shop'}));
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'shop@example.test'}});
 fireEvent.submit(screen.getByRole('form',{name:'Start shop setup'}));
 expect(await screen.findByRole('button',{name:'Resend in 1s'})).toBeDisabled();
 const retry=await screen.findByRole('button',{name:'Resend code'},{timeout:4000});
 fireEvent.click(retry);
 expect(await screen.findByText('Another code was requested. Check your email.')).toBeVisible();
 expect(source.resendSignIn).toHaveBeenCalledWith('test-challenge',expect.any(AbortSignal));
 expect(source.startSignIn).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:/Resend in/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Use email again'}));
 expect(screen.getByLabelText('Email')).toHaveValue('shop@example.test');
 expect(screen.queryByText(/Another code was requested/)).not.toBeInTheDocument();
});
