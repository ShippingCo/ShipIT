import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { RouteEventInput, RouteEventOperation, RouteEventResult, RouteExecutionRow } from './event-types.ts';
import { HttpError } from '../../plugins/errors.ts';
const operations = ['routes.departure','routes.delay','routes.arrival'] as const;
export async function execution(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,operations);
  const r=(await scopedQuery<RouteExecutionRow>(scope,[c.action],`SELECT r.* FROM shipit.routes r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[id])).rows[0];
  if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
export async function replay(scope:TenantAccess,key:string) {
  const c=assertTenantAccess(scope,operations);
  return (await scopedQuery<{fingerprint:string;result:RouteEventResult|null;requires_transit:boolean}>(scope,[c.action],`SELECT c.fingerprint,c.result,
    EXISTS(SELECT 1 FROM shipit.route_parcel_effects e WHERE e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id
      AND e.command_id=c.id AND e.parcel_event_id IS NOT NULL) AS requires_transit FROM shipit.route_commands c
    WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.principal_id=$1 AND c.operation_id=$2 AND c.key_digest=$3 FOR UPDATE OF c`,
    [c.actor.id,'api.v1.'+c.action,key])).rows[0];
}
export async function reserve(scope:TenantAccess,id:string,route:string,key:string,fingerprint:string,input:RouteEventInput,time:string) {
  const c=assertTenantAccess(scope,operations);
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.route_commands
    (id,organization_id,franchise_id,principal_id,route_id,operation_id,key_digest,fingerprint,expected_version,input,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,
    [id,c.permittedFranchiseIds[0],c.actor.id,route,'api.v1.'+c.action,key,fingerprint,input.expected_version,input,c.correlationId,time,c.organizationId]);
}
export async function members(scope:TenantAccess,manifest:string) {
  const c=assertTenantAccess(scope,operations);
  return (await scopedQuery<{parcel_id:string;booking_id:string;status:string;booking_state:string}>(scope,[c.action],`SELECT p.id AS parcel_id,p.booking_id,p.status,b.state AS booking_state
    FROM shipit.route_manifest_parcels m JOIN shipit.parcels p ON p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id AND p.id=m.parcel_id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.manifest_id=$1 ORDER BY p.id LIMIT 1001 FOR UPDATE OF p`,[manifest])).rows;
}
export async function revise(scope:TenantAccess,id:string,command:string,b:RouteEventInput,time:string) {
  const c=assertTenantAccess(scope,operations);
  const r=await scopedQuery(scope,[c.action],`UPDATE shipit.routes SET version=version+1,last_command_id=$2,updated_at=$3,
    execution_state=CASE $4 WHEN 'departure' THEN 'departed' WHEN 'arrival' THEN 'arrived' ELSE execution_state END,
    last_effective_at=$5,base_eta_at=CASE WHEN $4='departure' THEN $6::timestamptz ELSE base_eta_at END,
    total_delay_minutes=CASE WHEN $4='delay' THEN $7 ELSE total_delay_minutes END
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$8 AND state='finalized'`,
    [id,command,time,b.kind,b.effective_at,b.base_eta_at??null,b.total_delay_minutes??0,b.expected_version]);
  if(r.rowCount!==1)throw new HttpError('VERSION_CONFLICT');
}
export async function effect(scope:TenantAccess,result:RouteEventResult,command:string,parcel:string,booking:string,status:string,reason:string|null,parcelEvent:string|null) {
  const c=assertTenantAccess(scope,operations);
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.route_parcel_effects
    (organization_id,franchise_id,route_id,manifest_id,command_id,event_id,parcel_id,booking_id,route_version,effective_at,
     prior_status,outcome,skip_reason,base_eta_at,revised_eta_at,total_delay_minutes,parcel_event_id)
    SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16 WHERE {{franchise:$17:$1}}`,
    [c.permittedFranchiseIds[0],result.route_id,result.manifest_id,command,result.event_id,parcel,booking,result.version,result.effective_at,
      status,reason?'skipped':'updated',reason,reason?null:result.eta.base_at,reason?null:result.eta.revised_at,result.eta.total_delay_minutes,parcelEvent,c.organizationId]);
}
export async function finish(scope:TenantAccess,id:string,result:RouteEventResult) {
  const c=assertTenantAccess(scope,operations);
  await scopedQuery(scope,[c.action],`UPDATE shipit.route_commands SET state='committed',http_status=200,result=$2,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until=date_trunc('milliseconds',clock_timestamp())+interval '24 hours'
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[id,result]);
}
export async function latest(scope:TenantAccess,route:string) {
  return (await scopedQuery<{result:RouteEventResult}>(scope,['routes.read'],`SELECT result FROM shipit.route_commands
    WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND operation_id IN
      ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') AND state='committed'
    ORDER BY expected_version DESC LIMIT 1`,[route])).rows[0]?.result??null;
}
export const operationFor=(kind:RouteEventInput['kind']):RouteEventOperation=>`routes.${kind}`;

export async function detail(scope:TenantAccess,route:string,event:string) {
  const result=(await scopedQuery<{result:RouteEventResult}>(scope,['routes.read'],`SELECT c.result FROM shipit.route_commands c
    JOIN shipit.domain_events e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.route_command_id=c.id
    WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.route_id=$1 AND e.event_id=$2 AND c.state='committed'
      AND c.operation_id IN ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival')`,[route,event])).rows[0];
  if(!result)throw new HttpError('RESOURCE_NOT_FOUND');
  const items=(await scopedQuery<{parcel_id:string;outcome:string;skip_reason:string|null;revised_eta_at:Date|null;parcel_event_id:string|null}>(scope,['routes.read'],
    `SELECT parcel_id,outcome,skip_reason,revised_eta_at,parcel_event_id FROM shipit.route_parcel_effects
      WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND event_id=$2 ORDER BY parcel_id LIMIT 1001`,[route,event])).rows;
  if(items.length>1000)throw new HttpError('ROUTE_LIMIT_EXCEEDED');
  return {result:result.result,items:items.map(p=>({...p,revised_eta_at:p.revised_eta_at?.toISOString().replace('.000Z','Z')??null}))};
}
