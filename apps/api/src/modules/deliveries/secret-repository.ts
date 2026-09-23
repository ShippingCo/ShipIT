import { scopedQuery,type TenantAccess } from '../security/scope.ts';
export async function verifier(scope:TenantAccess,challenge:string) {
 const row=(await scopedQuery<{verifier:string|null}>(scope,['deliveries.complete'],`SELECT c.verifier FROM shipit.delivery_challenges c
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 FOR UPDATE`,[challenge])).rows[0];
 if(!row?.verifier)return '00'.repeat(32);return row.verifier;
}
