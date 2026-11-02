import {expect,it} from 'vitest';
import {serviceInput,calculateServiceQuote} from '../../src/modules/pricing/service-options.ts';
import {quote} from '../../src/modules/pricing/validation.ts';
import type {TenantAccess} from '../../src/modules/security/scope.ts';
import type {PricingVersionDto} from '@shippingco/shared';
const body={name:'Local priority',service:'standard',destination_key:'PUNE',accepts_liquids:false,pricing:{kind:'per_kg',first_kg_paise:10000,additional_kg_paise:2500,packing_paise:0}};
it('validates named rates without allowing client identities or ownership',()=>{
 expect(serviceInput(body)).toEqual(body);
 for(const change of [{id:'fake'},{organization_id:'fake'},{service:'invented'},{name:' '},{accepts_liquids:'true'},{pricing:{...body.pricing,kind:'flat'}},{pricing:{...body.pricing,first_kg_paise:1.5}},{pricing:{...body.pricing,packing_paise:Number.MAX_SAFE_INTEGER}}])expect(()=>serviceInput({...body,...change})).toThrow('VALIDATION_FAILED');
});
it('service option selection requires a generated UUID and participates in normalized quote input',()=>{
 const base={destination_key:'PUNE',service:'standard',weight_grams:1000};
 expect(quote({...base,service_option_id:'00000000-0000-4000-8000-000000000001'})).toHaveProperty('service_option_id');
 expect(()=>quote({...base,service_option_id:'Local priority'})).toThrow('VALIDATION_FAILED');
});
it('service rates cannot be accessed with a forged scope',async()=>{
 await expect(calculateServiceQuote({} as TenantAccess,{} as PricingVersionDto,{destination_key:'PUNE',service:'standard',weight_grams:1000,service_option_id:'00000000-0000-4000-8000-000000000001'},new Date(),'id','actor',false)).rejects.toThrow('ACTION_FORBIDDEN');
});
