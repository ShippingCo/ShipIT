import type {DatabasePool} from '@shippingco/db';
import type {ExpenseAttachmentDto,ExpenseAttachmentIntent} from '@shippingco/shared';
import {withCashbookScope} from '../memberships/service.ts';
import {createAttachmentLifecycle} from './service.ts';
import {expenseAttachmentDto,type AttachmentDependencies,type AttachmentScope} from './types.ts';
import * as r from './expense-repository.ts';
import * as v from './validation.ts';
/** Parent mode is chosen by the server factory; request DTOs cannot grant booking/proof access. */
export function createExpenseAttachmentService(database:DatabasePool,deps:AttachmentDependencies,writesEnabled=false) {
 return createAttachmentLifecycle<ExpenseAttachmentDto,ExpenseAttachmentIntent>(deps,{
  scope:<T>(session:string,query:unknown,action:'attachments.read'|'attachments.write'|'attachments.download',correlation:string,work:(s:AttachmentScope)=>Promise<T>)=>{
   const q=v.selection(query,['grant']);return withCashbookScope(database,session,q.organizationId,q.franchiseId,action==='attachments.write'?'cashbook.request':'cashbook.select',correlation,async s=>work({access:s.access,ownOnly:s.ownOnly,agentOnly:false,metadataOnly:false}));
  },parent:r.parent,find:r.find,list:r.list,quota:r.quota,insert:r.insert,dto:expenseAttachmentDto,intent:v.expenseIntent,
  listPurpose:'expense_evidence',domain:id=>'expense:'+id,path:id=>`/api/v1/cashbook/requests/${id}/attachments`,newWrite:(s,id,operation)=>r.newWrite(s,id,operation,writesEnabled),
 });
}
