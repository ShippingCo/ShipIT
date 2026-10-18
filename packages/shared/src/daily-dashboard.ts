export type DailyComparisonMode='complete_day'|'same_elapsed';
export type DailyPeriod='today'|'yesterday';
export interface DailyFilter {day:string|null;mode:DailyComparisonMode;franchise_ids:string[]}
/** Money stays integer paise on the server. Null ratios have no eligible denominator. */
export interface DailyMetrics {
 bookings:number;billed_gross:string;tax_exclusive_revenue:string;average_bill:string|null;
 collections:string;refunds:string;outstanding:string;customers:number;new_customers:number;returning_customers:number;
 methods:{method:string;paise:string}[];
}
export interface DailyRow {
 id:string;franchise_id:string;period:DailyPeriod;kind:'booking'|'receipt'|'legacy_collection'|'refund'|'advance_refund';
 occurred_at:string;customer_id:string|null;method:string|null;eligible:boolean;in_period:boolean;new_customer:boolean;
 billed_gross:string;tax_exclusive_revenue:string;collections:string;refunds:string;outstanding:string;
}
export interface DailySnapshot {
 id:string;schema_version:1;definition:'owner_daily_v1';timezone:'Asia/Kolkata';organization_id:string;franchise_id:string;
 filter:DailyFilter;as_of:string;expires_at:string;count:number;
 windows:{period:DailyPeriod;from:string;to:string}[];today:DailyMetrics;yesterday:DailyMetrics;
 comparison:{metric:'bookings'|'billed_gross'|'tax_exclusive_revenue'|'average_bill'|'collections'|'refunds'|'outstanding'|'customers'|'new_customers'|'returning_customers';delta:string|null;percent:string|null}[];
}
export interface DailyPage {snapshot:DailySnapshot;rows:DailyRow[];next_offset:number|null}
export interface DailyExport {snapshot:DailySnapshot;columns:readonly string[];csv:string}
