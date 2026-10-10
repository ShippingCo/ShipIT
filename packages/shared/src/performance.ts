import type { ReportFilter } from './report.ts';
import type { ageingStatuses } from './ageing.ts';
export interface PerformanceFilter extends ReportFilter { eta:'original'|'revised' }
export interface PerformanceRow {
  id:string; booking_id:string; customer_id:string; confirmed_at:string; version:number;
  destination:string|null; service:string|null; courier:string|null;
  status:typeof ageingStatuses[number]; failed_attempts:number;
  dispatched_at:string|null; delivered_at:string|null;
  original_eta_at:string|null; revised_eta_at:string|null;
  original_eta_version:number|null; revised_eta_version:number|null;
  route_id:string|null; manifest_id:string|null; route_departed_at:string|null; route_arrived_at:string|null;
  duration_seconds:number|null; outcome:'on_time'|'delayed'|'open'|'rto'|'unknown';
}
export interface PerformanceSummary {
  booked:number; dispatched:number; delivered:number; open:number; rto:number;
  failed_parcels:number; failed_attempts:number;
  on_time:{numerator:number;denominator:number;excluded:number};
  duration:{total_seconds:number;denominator:number;excluded:number};
  unknown_destination:number;unknown_courier:number;
}
export interface PerformanceGroup { key:string|null; summary:PerformanceSummary }
export interface PerformanceSnapshot {
  id:string;schema_version:1;definition:'delivery_performance_v1';timezone:'Asia/Kolkata';
  organization_id:string;franchise_id:string;audience:'franchise'|'assignment';filter:PerformanceFilter;as_of:string;expires_at:string;
  freshness:{state:'captured';captured_at:string};count:number;summary:PerformanceSummary;
  destinations:PerformanceGroup[];routes:PerformanceGroup[];
}
export interface PerformanceSelection {destination:string|null;route_id:string|null;count:number;summary:PerformanceSummary}
export interface PerformancePage {snapshot:PerformanceSnapshot;selection:PerformanceSelection;rows:PerformanceRow[];next_offset:number|null}
export interface PerformanceExport {snapshot:PerformanceSnapshot;selection:PerformanceSelection;columns:readonly string[];csv:string}
