export type ParcelReceiptKind='agent_received'|'office_received'|'recipient_received';
export type ParcelDiscrepancy='none'|'missing'|'damaged'|'tampered'|'label_mismatch';
export interface ParcelHandoverInput {
 agent_id:string;items:{parcel_id:string;expected_parcel_version:number;previous_receipt_id:string|null;instruction_id:string|null;grant_id:string|null}[];
}
export interface ParcelCustodyCommandDto {command_id:string;resource_id:string;receipt_ids:string[];recorded_at:string}
export interface ParcelReturnInput {parcel_id:string;expected_parcel_version:number;source_receipt_id:string;discrepancy:ParcelDiscrepancy}
export interface ParcelCustodyGrantInput {parcel_id:string;source_receipt_id:string;destination_kind:'agent'|'office';destination_agent_id:string|null}
export interface ParcelReleaseInput {parcel_id:string;source_receipt_id:string;grant_id:string;manifest_id:string|null}
export interface ParcelHandoverDto {
 id:string;agent_id:string;recorded_at:string;state:'prepared'|'acknowledged'|'cancelled';version:1|2;
 items:{id:string;parcel_id:string;expected_parcel_version:number;previous_receipt_id:string|null;receipt_id:string|null}[];
}

export type ParcelCustodyOutcome='delivered'|'returned'|'held'|'reassigned'|'pending';
export interface ParcelCustodyReportDto {
 manifest_id:string;agent_id:string;as_of:string;
 totals:{total:number;delivered:number;returned:number;held:number;reassigned:number;pending:number;failed:number};
 failure_count:number;
 items:{item_id:string;parcel_id:string;outcome:ParcelCustodyOutcome;origin_receipt_id:string|null;current_receipt_id:string|null;proof_id:string|null;failure_ids:string[]}[];
}

export interface ParcelCustodyWorklistDto {
 as_of:string;next_cursor:string|null;
 items:{parcel_id:string;docket:string;parcel_version:number;status:string;assigned_agent_id:string|null;
  attempt_id:string|null;receipt_id:string|null;physical_custody:'unknown'|'agent'|'office'|'recipient';proof_id:string|null}[];
}

export interface ParcelCustodySnapshotDto {
 id:string;definition:'custody_manifest_v1';organization_id:string;franchise_id:string;as_of:string;expires_at:string;count:number;
 report:Omit<ParcelCustodyReportDto,'items'>;items:ParcelCustodyReportDto['items'];
}

export interface ParcelCustodyTransferDto {
 id:string;parcel_id:string;source_receipt_id:string;agent_id:string;destination_kind:'agent'|'office';destination_agent_id:string|null;
 parcel_version:number;assigned_agent_id:string|null;can_prepare:boolean;instruction_id:string|null;office_release_id:string|null;
}
export interface ParcelCustodyTransferPage {items:ParcelCustodyTransferDto[];next_cursor:string|null}
export interface ParcelCustodyOutgoingManifestPage {grant_id:string;items:{id:string;agent_id:string;released:boolean}[];next_cursor:string|null}
