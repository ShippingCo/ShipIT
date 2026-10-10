import React,{useMemo} from 'react';
import type {CashbookRequestDetail} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {createExpenseAttachmentClient} from '../data-access/attachments';
import {ExpenseAttachmentUploader} from '../components/m3/AttachmentUploader';
export default function ExpenseProofs({controller,detail,canRequest,locked,onActivity}:{controller:ScopeController;detail:CashbookRequestDetail;canRequest:boolean;locked:boolean;onActivity:(busy:boolean)=>void}){
 const client=useMemo(()=>createExpenseAttachmentClient(controller.runtime,detail.request.id),[controller.runtime,detail.request.id]),own=canRequest&&detail.request.actor_id===controller.runtime.ticket().authority?.userId;
 return <section aria-label="Private expense receipt evidence"><h3 className="t-title-md">Private expense receipt evidence</h3><p>Optional private photos, voice notes or videos. A screenshot alone does not establish settlement. Approval freezes the ready evidence; uploads after review are blocked.</p>{!own&&<p>Only the request submitter can add or cancel proof. Your role can read permitted saved evidence.</p>}<ExpenseAttachmentUploader client={client} runtime={controller.runtime} canUpload={own&&!detail.decision} canCancel={own&&detail.decision?.decision!=='approved'} locked={locked} onActivity={onActivity}/>{detail.decision?.attachments?.length? <p>Reviewed evidence references: {detail.decision.attachments.map(a=>a.id+' · version '+a.version).join('; ')}.</p>:null}</section>;
}
