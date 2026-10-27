import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {businessDay,dayStart,shiftDay,weekMonday,datePreset} from '../operations/business-dates';
import {DatePresets} from '../operations/DatePresets';
it('uses IST midnight and Monday weeks across Sunday, month and year boundaries',()=>{
 expect(businessDay(new Date('2026-10-25T18:29:59Z'))).toBe('2026-10-25');
 expect(businessDay(new Date('2026-10-25T18:30:00Z'))).toBe('2026-10-26');
 expect(datePreset('week',new Date('2026-10-25T18:29:59Z'))).toEqual({from:'2026-10-19',to:'2026-10-25'});
 expect(datePreset('week',new Date('2026-10-25T18:30:00Z'))).toEqual({from:'2026-10-26',to:'2026-10-26'});
 expect(weekMonday('2027-01-01')).toBe('2026-12-28');expect(shiftDay('2024-02-28',1)).toBe('2024-02-29');expect(dayStart('2026-10-26')).toBe('2026-10-25T18:30:00.000Z');
});
it('date presets edit the range without submitting or replacing saved report evidence',()=>{
 const change=vi.fn(),submit=vi.fn(e=>e.preventDefault());render(<form onSubmit={submit}><DatePresets change={change}/></form>);
 fireEvent.click(screen.getByRole('button',{name:'Today'}));expect(change).toHaveBeenLastCalledWith(...Object.values(datePreset('today')));
 fireEvent.click(screen.getByRole('button',{name:'This week'}));expect(change).toHaveBeenLastCalledWith(...Object.values(datePreset('week')));expect(submit).not.toHaveBeenCalled();
});
