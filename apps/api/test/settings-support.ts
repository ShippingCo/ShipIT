import type {TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import type {SettingsOwner,SettingsUpdateInput} from '@shippingco/shared';
import {auditSetup,org,A} from './audit-support.ts';
import {createSettingsService} from '../src/modules/settings/service.ts';
export const settingsQuery={organization_id:org,franchise_id:A},organizationQuery={organization_id:org};
export const settingsHeaders=(key:string)=>['idempotency-key',key];
export async function settingsSetup(t:TestContext){
 const s=await auditSetup(t);await s.db.prepareSettings();const local=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),service=createSettingsService(s.pool,true);
 const update=(input:SettingsUpdateInput,owner:SettingsOwner='franchise',token=local.token,key=randomUUID(),query:unknown=owner==='organization'?organizationQuery:settingsQuery)=>service.update(token,owner,query,key,settingsHeaders(key),input,randomUUID());
 const read=(owner:SettingsOwner='franchise',token=local.token,query:unknown=owner==='organization'?organizationQuery:settingsQuery)=>service.read(token,owner,query,randomUUID());
 return {...s,local,operator,service,update,read};
}
