import { HttpError } from '../../plugins/errors.ts';
import { integer,object,uuid } from '../tax/validation.ts';
import type { ExceptionalReason } from './types.ts';

const reasons:readonly ExceptionalReason[]=['recipient_channel_unavailable','provider_unavailable','challenge_locked_reviewed'];
export const selector=(value:unknown)=>{const b=object(value,['organization_id','franchise_id']);return {organizationId:uuid(b.organization_id,'organization_id'),franchiseId:uuid(b.franchise_id,'franchise_id')};};
export const expected=(value:unknown,keys:readonly string[])=>{const b=object(value,keys);return {body:b,expected_version:integer(b.expected_version,'expected_version',1,2147483646)};};
export function start(value:unknown) {const {body,expected_version}=expected(value,['expected_version','agent_id','handover_evidence_ref']);return {expected_version,agent_id:uuid(body.agent_id),handover_evidence_ref:uuid(body.handover_evidence_ref,'evidence_ref')};}
export function proof(value:unknown) {const {body,expected_version}=expected(value,['expected_version','challenge_ref','challenge_version','proof']);if(typeof body.proof!=='string'||!/^\d{6}$/.test(body.proof))throw new HttpError('VALIDATION_FAILED');return {expected_version,challenge_ref:uuid(body.challenge_ref),challenge_version:integer(body.challenge_version,'expected_version',1,2147483646),proof:body.proof};}
export function resend(value:unknown) {const {body,expected_version}=expected(value,['expected_version','challenge_ref']);return {expected_version,challenge_ref:uuid(body.challenge_ref)};}
export function replace(value:unknown) {const {body,expected_version}=expected(value,['expected_version','challenge_ref','reason_code']);if(!['expired','recorded_compromise'].includes(String(body.reason_code)))throw new HttpError('VALIDATION_FAILED');return {expected_version,challenge_ref:uuid(body.challenge_ref),reason_code:body.reason_code as 'expired'|'recorded_compromise'};}
export function exceptionRequest(value:unknown) {const {body,expected_version}=expected(value,['expected_version','reason_code','evidence_id','recipient_present']);if(!reasons.includes(body.reason_code as ExceptionalReason)||body.recipient_present!==true)throw new HttpError('VALIDATION_FAILED');return {expected_version,reason_code:body.reason_code as ExceptionalReason,evidence_id:uuid(body.evidence_id),recipient_present:true as const};}
export function exceptionApproval(value:unknown) {const {body,expected_version}=expected(value,['expected_version','request_id']);return {expected_version,request_id:uuid(body.request_id)};}
export function exceptionalCompletion(value:unknown) {const {body,expected_version}=expected(value,['expected_version','approval_ref']);return {expected_version,approval_ref:uuid(body.approval_ref)};}
