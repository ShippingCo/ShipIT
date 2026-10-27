import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {SegmentedControl} from '../components/m3/Button';
it('chooses a payment segment without submitting its surrounding booking form',()=>{
 const submit=vi.fn(e=>e.preventDefault()),change=vi.fn();
 render(<form onSubmit={submit}><SegmentedControl value="topay" onChange={change} options={[{value:'topay',label:'To Pay'},{value:'paid',label:'Paid'}]}/><button type="submit">Confirm booking</button></form>);
 fireEvent.click(screen.getByRole('button',{name:'Paid'}));
 expect(change).toHaveBeenCalledWith('paid');expect(submit).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Paid'})).toHaveAttribute('type','button');
 fireEvent.click(screen.getByRole('button',{name:'Confirm booking'}));expect(submit).toHaveBeenCalledOnce();
});
