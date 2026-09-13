import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import type { ParcelDto } from '../bookings/types.ts';
export async function insert(scope: TenantAccess, booking: string, index: number, parcel: ParcelDto, manual: string|null) {
  const c = assertTenantAccess(scope,['parcels.create']);
  const row = (await scopedQuery<{docket:string}>(scope,['parcels.create'],`INSERT INTO shipit.parcels
    (id,organization_id,franchise_id,booking_id,position,docket,weight_grams,sender_snapshot,recipient_snapshot)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}} RETURNING docket`,
  [parcel.id,c.permittedFranchiseIds[0],booking,index,manual,parcel.weight_grams,parcel.sender,parcel.recipient,c.organizationId])).rows[0]!;
  return row.docket;
}
