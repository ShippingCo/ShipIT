import type { ReportFilter } from './report.ts';
export const shipmentCostCategories=['courier','packing','agent','payment'] as const;
export type ShipmentCostCategory=typeof shipmentCostCategories[number];
export type ShipmentCostState='actual'|'estimated'|'not_applicable';
export interface ShipmentCostAllocation {booking_id:string;parcel_id:string|null;amount_paise:number}
export interface ShipmentCostInput {
 source_id:string|null;expected_version:number;category:ShipmentCostCategory;state:ShipmentCostState;
 amount_paise:number;effective_at:string;reason:string;reference:string;
 supplier:string|null;document:string|null;line:string|null;
 expense_id:string|null;rate_import_id:string|null;rate_booking_id:string|null;
 allocations:ShipmentCostAllocation[];
}
export interface ShipmentCostEvidence {
 kind:'manual'|'carrier_rate'|'applied_expense'|'declaration';independently_verified:false;
 supplier:string|null;document:string|null;line:string|null;expense_root_id:string|null;expense_head_id:string|null;
 rate_import_id:string|null;rate_booking_id:string|null;rate_approval_id:string|null;rate_row:number|null;rate_mapping_ids:string[];
 rate_version:string|null;rate_inputs:{service:string;destination_key:string;weight_grams:number}|null;
}
export interface ShipmentCostRevision {
 id:string;source_id:string;version:number;category:ShipmentCostCategory;state:ShipmentCostState;
 amount_paise:string;effective_at:string;recorded_at:string;actor_id:string;reason:string;reference:string;
 allocation_rule:'manual_declared_v1';allocations:ShipmentCostAllocation[];allocated_paise:string;remainder_paise:string;evidence:ShipmentCostEvidence;
}
export interface ShipmentCostDetail {id:string;category:ShipmentCostCategory;version:number;revisions:ShipmentCostRevision[]}
export interface ShipmentCostList {items:ShipmentCostRevision[];next_cursor:string|null}
export interface ShipmentCostPreview {id:string;schema_version:1;rows:{row:number;input:ShipmentCostInput;amount_paise:string;evidence:ShipmentCostEvidence;error:string|null}[];valid:boolean}
export interface ShipmentCostApply {preview_id:string;items:ShipmentCostRevision[]}
export interface ShipmentCostSelectors {
 bookings:{id:string;confirmed_at:string;service:string|null;destination:string|null;parcels:string[]}[];
 expenses:{id:string;root_id:string;category:string;amount_paise:string;occurred_at:string;agent_basis:string|null}[];
 rates:{id:string;approval_id:string;courier_id:string;effective_from:string;effective_to:string}[];
 next_cursor:string|null;
}
export interface ContributionFilter extends ReportFilter {effective_at:string|null;recorded_at:string|null;franchise_ids:string[]}
export interface ContributionCost {
 source_id:string;revision_id:string|null;version:number;category:ShipmentCostCategory;state:ShipmentCostState;
 amount_paise:string;source_amount_paise:string;remainder_paise:string;effective_at:string;recorded_at:string;
 expense_root_id:string|null;expense_head_id:string|null;expense_effect_id:string|null;earning_id:string|null;proof_id:string|null;
 reference:string;verification:'recorded_unverified'|'native_applied';
}
export interface ContributionRow {
 id:string;franchise_id:string;confirmed_at:string;customer_id:string;service:string|null;destination:string|null;courier:string;
 booking_command_id:string;financial_change_ids:string[];dispatch_command_ids:string[];revenue_paise:string;
 costs:ContributionCost[];coverage:Record<ShipmentCostCategory,'actual'|'estimated'|'missing'|'not_applicable'>;
 actual_cost_paise:string;estimated_cost_paise:string;contribution_paise:string|null;estimated_contribution_paise:string|null;
 state:'actual'|'estimated'|'incomplete';
}
export interface ContributionTotals {count:number;revenue_paise:string;actual_cost_paise:string;estimated_cost_paise:string;contribution_paise:string|null;estimated_contribution_paise:string|null;actual_count:number;estimated_count:number;missing_count:number}
export interface ContributionGroup extends ContributionTotals {dimension:'courier'|'service'|'customer'|'destination'|'period';value:string}
export interface ContributionExpense {root_id:string;head_id:string;effect_id:string;earning_id:string|null;category:string;occurred_at:string;recorded_at:string;amount_paise:string;attributed_paise:string;unallocated_paise:string}
export interface ContributionSnapshot {
 id:string;schema_version:1;definition:'shipment_contribution_v1';organization_id:string;franchise_id:string;timezone:'Asia/Kolkata';
 filter:ContributionFilter;as_of:string;effective_at:string;recorded_at:string;expires_at:string;count:number;
 totals:ContributionTotals;groups:ContributionGroup[];shop_expenses:ContributionExpense[];
}
export interface ContributionPage {snapshot:ContributionSnapshot;rows:ContributionRow[];next_offset:number|null}
export const contributionColumns=['snapshot_id','captured_at','effective_at','recorded_at','definition','booking_id','franchise_id','confirmed_at','customer_id','service','destination','courier','revenue_paise','actual_cost_paise','estimated_cost_paise','contribution_paise','estimated_contribution_paise','state','courier_coverage','packing_coverage','agent_coverage','payment_coverage','source_ids','source_revision_ids','expense_head_ids','financial_change_ids','dispatch_command_ids'] as const;
export interface ContributionExport {snapshot:ContributionSnapshot;columns:readonly string[];csv:string}
