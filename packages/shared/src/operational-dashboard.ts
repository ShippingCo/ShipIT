/** Read-only operational counts; contains no payment or customer projection. */
export const operationalParcelStatuses=['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto','cancelled'] as const;
/**
 * The length of the trailing daily series, and so the longest chart range the dashboard can
 * draw. Thirty days is the point where a shop owner stops recognising individual days, and it
 * is a fixed width on purpose: the endpoint takes no range parameter, so its cost cannot be
 * driven by the screen.
 */
export const dashboardSeriesDays=30;
export interface OperationalDashboardDay {day:string;bookings:number;delivered:number}
export interface OperationalDashboard {
  as_of:string;
  timezone:'Asia/Kolkata';
  day:string;
  booked_today:number;
  booked_yesterday:number;
  /** The comparison the dashboard actually shows. Courier volume is weekly-cyclical. */
  booked_same_weekday_last_week:number;
  delivered_today:number;
  stages:Record<typeof operationalParcelStatuses[number],number>;
  week:{day:string;bookings:number}[];
  /** Exactly `dashboardSeriesDays` entries, oldest first, the last of which is `day`. */
  days:OperationalDashboardDay[];
}
