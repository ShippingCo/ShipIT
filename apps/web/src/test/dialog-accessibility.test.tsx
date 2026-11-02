import React, {useState} from 'react';
import {expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ConfirmDialog} from '../components/m3/Dialog';

function Example({confirm}:{confirm:()=>void}) {
 const [open,setOpen]=useState(false);
 return <><button onClick={()=>setOpen(true)}>Clear local demo</button><ConfirmDialog open={open} onClose={()=>setOpen(false)} title="Clear local demo data?" body="Only fictional records in this browser will be removed." confirmLabel="Clear demo data" danger onConfirm={confirm}/></>;
}

it('names the confirmation, focuses Cancel, and restores the opener on Escape without confirming',async()=>{
 const confirm=vi.fn();render(<Example confirm={confirm}/>);
 const opener=screen.getByRole('button',{name:'Clear local demo'});opener.focus();fireEvent.click(opener);
 expect(await screen.findByRole('dialog',{name:'Clear local demo data?'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Cancel'})).toHaveFocus();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await waitFor(()=>expect(opener).toHaveFocus());expect(confirm).not.toHaveBeenCalled();
});

it('performs the confirmed action once and closes the modal',async()=>{
 const confirm=vi.fn();render(<Example confirm={confirm}/>);
 fireEvent.click(screen.getByRole('button',{name:'Clear local demo'}));
 fireEvent.click(await screen.findByRole('button',{name:'Clear demo data'}));
 expect(confirm).toHaveBeenCalledTimes(1);
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
