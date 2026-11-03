import {expect,it} from 'vitest';
import {bookingDetails} from '../../src/modules/bookings/details.ts';
it('accepts declared value alone and retains strict validation of any supplied structured facts',()=>{
 expect(bookingDetails({declared_value_paise:0})).toEqual({declared_value_paise:0});
 for(const input of [{},{declared_value_paise:-1},{declared_value_paise:1.5},{declared_value_paise:'5'},{declared_value_paise:1,city:'Mumbai'},{declared_value_paise:1,organization_id:'other'}])expect(()=>bookingDetails(input)).toThrow('VALIDATION_FAILED');
});
