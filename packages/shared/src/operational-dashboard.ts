/** Read-only operational counts; contains no payment or customer projection. */
export const operationalParcelStatuses=['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto','cancelled'] as const;
export interface OperationalDashboard {
  as_of:string;
  timezone:'Asia/Kolkata';
  day:string;
  booked_today:number;
  booked_yesterday:number;
  delivered_today:number;
  stages:Record<typeof operationalParcelStatuses[number],number>;
  week:{day:string;bookings:number}[];
}
