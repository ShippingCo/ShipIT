export const custodyActions=['custody.read','custody.prepare','custody.authorize','custody.acknowledge','custody.return','custody.grant','custody.release','custody.export'] as const;
export type CustodyAction=typeof custodyActions[number];
export type ReceiptKind='agent_received'|'office_received'|'recipient_received';
export interface CustodyReceiptFact {
 id:string;parcel_id:string;sequence:number;previous_receipt_id:string|null;kind:ReceiptKind;
 agent_id:string|null;recorded_at:Date;proof_id:string|null;
}
export interface ManifestItemFact {
 id:string;parcel_id:string;agent_id:string;prepared_at:Date;receipt_id:string|null;
}
export interface CustodyFailureFact {id:string;parcel_id:string;agent_id:string;recorded_at:Date}
export interface CustodyProofFact {id:string;parcel_id:string;completed_by:string;completed_at:Date}
