import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {LotCandidates} from '../operations/LotCandidates';
import type {ParcelSource} from '../data-access/parcels';
it('filters candidates by server destination, ungrouped state and IST booking date before deliberate selection',async()=>{
 const list=vi.fn(async()=>({items:[{id:'parcel-reference',docket:'SYN-DEST',confirmed_at:'2026-10-26T00:00:00Z'}],page:{has_more:false,next_cursor:null}})),select=vi.fn();
 render(<LotCandidates source={{list} as unknown as ParcelSource} destination="MUMBAI" select={select} busy={false}/>);
 await screen.findByRole('button',{name:'Select SYN-DEST'});
 fireEvent.change(screen.getByLabelText('Lot selection booked from'),{target:{value:'2026-10-26'}});fireEvent.change(screen.getByLabelText('Lot selection booked through'),{target:{value:'2026-10-26'}});
 await waitFor(()=>expect(list).toHaveBeenLastCalledWith(expect.objectContaining({destination_key:'MUMBAI',status:'booked',ungrouped:true,from:'2026-10-25T18:30:00.000Z',to:'2026-10-26T18:30:00.000Z',cursor:null}),expect.any(AbortSignal)));
 expect(select).not.toHaveBeenCalled();fireEvent.click(await screen.findByRole('button',{name:'Select SYN-DEST'}));expect(select).toHaveBeenCalledWith('parcel-reference');
});
