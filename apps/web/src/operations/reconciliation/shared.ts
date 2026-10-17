import type {ReconciliationData} from '../../data-access/reconciliation';
export type Result=Awaited<ReturnType<ReconciliationData['execute']>>;
export interface Workspace {source:ReconciliationData;account:string;revision:number;locked:boolean;enabled:boolean;admin:boolean;mutate:(path:string,body:unknown,success?:(result:Result)=>void)=>Promise<void>}
export const paged=<T,>(p:{items:T[];next_cursor:string|null})=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}});
