import {parseSettingsTimezone} from '@shippingco/shared';
import {filterInput} from '../../src/modules/audit/validation.ts';
import {describe,it,expect} from 'vitest';
import {update,value} from '../../src/modules/settings/validation.ts';
import {parseEnvironment} from '../../src/env.ts';
import {salesFilter} from '../../src/modules/reports/sales-service.ts';
import {filter} from '../../src/modules/shipment-costs/validation.ts';
import {quote} from '../../src/modules/pricing/validation.ts';
const id='00000000-0000-4000-8000-000000000001';
const config={NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'};
describe('strict versioned configuration and rollout contract',()=>{
 it('keeps unset, configured empty hours/holidays, and clear distinct without invented calendar values',()=>{
  expect(update({expected_version:0,changes:{operating_hours:{timezone:'UTC',days:[]}},reason:'Synthetic explicit empty'}).changes).toEqual({operating_hours:{timezone:'UTC',days:[]}});
  expect(update({expected_version:1,changes:{collection_calendar:null},reason:'Synthetic clear'}).changes).toEqual({collection_calendar:null});
  expect(value('collection_calendar',{timezone:'Asia/Kolkata',weekdays:[4,2],holidays:[]})).toEqual({timezone:'Asia/Kolkata',weekdays:[2,4],holidays:[]});
 });
 it.each([undefined,null,{},[],{timezone:'Asia/Kolkata',weekdays:[],holidays:[]},{timezone:'Asia/Kolkata',weekdays:[7],holidays:[]},{timezone:'Asia/Kolkata',weekdays:[1],holidays:['0000-01-01']},{timezone:'Asia/Kolkata',weekdays:[1],holidays:['2024-02-30']},{timezone:'Asia/Kolkata',weekdays:[1],holidays:['2024-02-29','2024-02-29']},{timezone:'Asia/Kolkata',weekdays:[1],holidays:[],source:'public-provider'}])('rejects unapproved or malformed calendar input %j',input=>{
  expect(()=>value('collection_calendar',input)).toThrow('VALIDATION_FAILED');
 });
 it('rejects unsupported thresholds, invented references, server switches and all owner/version/time mass assignment',()=>{
  for(const changes of [{approval_policy:{threshold_paise:1}},{approval_policy:{allow_self_approval:true}},{billing_terms:{state:'configured',owner:'account_terms_v1'}},{SETTINGS_WRITES_ENABLED:true},{identity:{display_name:'Synthetic',token:'private'}},{language:{locale:true}},{close_cutoff:{timezone:'UTC',minute:0.5}}])expect(()=>update({expected_version:0,changes,reason:'Synthetic rejected'})).toThrow('VALIDATION_FAILED');
  for(const extra of [{owner:'organization'},{actor_id:id},{version_id:id},{effective_at:'2099-01-01T00:00:00Z'},{expected_version:'0'},{expected_version:-1},{changes:{}}])expect(()=>update({expected_version:0,changes:{language:{locale:'en'}},reason:'Synthetic rejected',...extra})).toThrow('VALIDATION_FAILED');
 });
 it('defaults settings writes off and rejects invalid/demo server activation',()=>{
  expect(parseEnvironment(config).settingsWritesEnabled).toBe(false);expect(parseEnvironment({...config,SETTINGS_WRITES_ENABLED:'true'}).settingsWritesEnabled).toBe(true);
  for(const enabled of ['yes','TRUE','1'])expect(()=>parseEnvironment({...config,SETTINGS_WRITES_ENABLED:enabled})).toThrow('CONFIGURATION_INVALID');
  expect(()=>parseEnvironment({...config,NODE_ENV:'demo',SETTINGS_WRITES_ENABLED:'true'})).toThrow('CONFIGURATION_INVALID');
 });
 it('allows the safe settings audit resource filter without accepting arbitrary resource types',()=>{
  expect(filterInput({organization_id:id,resource_type:'settings_version',resource_id:id}).resourceType).toBe('settings_version');
  expect(()=>filterInput({organization_id:id,resource_type:'settings_secrets'})).toThrow('VALIDATION_FAILED');
 });
 it('preserves legacy normalized intents exactly when optional provenance is absent',()=>{
  const pricing={destination_key:'SYN_DEST',service:'standard',weight_grams:999};expect(quote(pricing)).toEqual(pricing);expect(quote({...pricing,settings_version_id:id})).toEqual({...pricing,settings_version_id:id});
  const dates={from_day:'2026-10-12',to_day:'2026-10-12'},sale=salesFilter(dates,id),contribution=filter(dates,id);
  expect(Object.hasOwn(sale,'settings_version_id')).toBe(false);expect(Object.hasOwn(contribution,'settings_version_id')).toBe(false);
  expect(salesFilter({...dates,settings_version_id:id},id)).toEqual({...sale,settings_version_id:id});expect(filter({...dates,settings_version_id:id},id)).toEqual({...contribution,settings_version_id:id});
 });
});

describe('timezone settings preserve intent spelling across ICU aliases and casing',()=>{
 it.each(['Asia/Kolkata','asia/kolkata','ASIA/KOLKATA','Asia/Calcutta','US/Eastern','utc','UTC',' Etc/UTC '])('accepts %s consistently for every timezone family',timezone=>{
  const expected=timezone.trim();expect(parseSettingsTimezone(timezone)).toBe(expected);
  expect(value('operating_hours',{timezone,days:[]}).timezone).toBe(expected);
  expect(value('close_cutoff',{timezone,minute:0}).timezone).toBe(expected);
  expect(value('reporting_schedule',{timezone,report:'sales',franchise_ids:[id],weekday:1,minute:0}).timezone).toBe(expected);
 });
 it.each(['Browser/Local','+05:30','EST','',null,123,'UTC\n','A'.repeat(65)])('rejects unsupported or malformed %j consistently',timezone=>{
  expect(parseSettingsTimezone(timezone)).toBeNull();
  for(const [key,input] of [['operating_hours',{timezone,days:[]}],['close_cutoff',{timezone,minute:0}],['reporting_schedule',{timezone,report:'sales',franchise_ids:[id],weekday:1,minute:0}]] as const)expect(()=>value(key,input)).toThrow('VALIDATION_FAILED');
 });
 it('does not expand the fixed collection calendar zone contract',()=>{
  for(const timezone of ['asia/kolkata','Asia/Calcutta','UTC'])expect(()=>value('collection_calendar',{timezone,weekdays:[1],holidays:[]})).toThrow('VALIDATION_FAILED');
 });
});
