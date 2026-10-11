import {randomUUID} from 'node:crypto';
import type {ParcelRow,ItemRow} from '../custody/repository.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {HttpError} from '../../plugins/errors.ts';

/** Apply the exact W10 instruction only inside its receiving agent's W16 acknowledgement. */
export async function acknowledgeReassignment(scope:TenantAccess,p:ParcelRow,item:ItemRow,acknowledgement:string){
 const c=assertTenantAccess(scope,['custody.acknowledge']),command=randomUUID(),event=randomUUID();
 if(!item.instruction_id||!p.attempt_id||!p.assignment_id||!p.assigned_agent_id||item.agent_id!==c.actor.id)throw new HttpError('CUSTODY_CONFLICT');
 const input={expected_version:p.version,evidence_ref:item.instruction_id,attempt_id:p.attempt_id,assignment_id:p.assignment_id,
  from_agent_id:p.assigned_agent_id,agent_id:c.actor.id,instruction_id:item.instruction_id,acknowledgement_command_id:acknowledgement};
 const time=(await scopedQuery<{instant:Date}>(scope,['custody.acknowledge'],`SELECT date_trunc('milliseconds',clock_timestamp()) instant
  FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}`)).rows[0]!.instant;
 await scopedQuery(scope,['custody.acknowledge'],`INSERT INTO shipit.parcel_commands
  (id,principal_id,organization_id,franchise_id,booking_id,parcel_id,operation_id,key_digest,fingerprint,expected_version,from_status,to_status,input,correlation_id)
  SELECT $1,$2,{{organization}},$3,$4,$5,'api.v1.deliveries.reassign',$6,$7,$8,'out_for_delivery','out_for_delivery',$9,$10 WHERE {{franchise:$11:$3}}`,
  [command,c.actor.id,c.permittedFranchiseIds[0],p.booking_id,p.id,keyDigest(acknowledgement+':'+p.id),digest(input),p.version,input,c.correlationId,c.organizationId]);
 const attempt=await scopedQuery(scope,['custody.acknowledge'],`UPDATE shipit.delivery_attempts a SET agent_id=$2
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1 AND a.agent_id=$3 AND a.state='active' AND a.assignment_id=$4 RETURNING a.id`,
  [p.attempt_id,c.actor.id,p.assigned_agent_id,p.assignment_id]);
 if(attempt.rows.length!==1)throw new HttpError('CUSTODY_CONFLICT');
 const updated=await scopedQuery(scope,['custody.acknowledge'],`UPDATE shipit.parcels p SET assigned_agent_id=$2,version=version+1,last_command_id=$3,updated_at=$4
  WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND p.version=$5 AND p.status='out_for_delivery' AND p.active_attempt_id=$6 RETURNING p.id`,
  [p.id,c.actor.id,command,time,p.version,p.attempt_id]);
 if(updated.rows.length!==1)throw new HttpError('VERSION_CONFLICT');
 await scopedQuery(scope,['custody.acknowledge'],`INSERT INTO shipit.parcel_transitions
  (id,organization_id,franchise_id,booking_id,parcel_id,command_id,sequence,operation_id,from_status,to_status,actor_id,evidence_ref,correlation_id,occurred_at)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,'deliveries.reassign','out_for_delivery','out_for_delivery',$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,
  [event,c.permittedFranchiseIds[0],p.booking_id,p.id,command,p.version+1,c.actor.id,item.instruction_id,c.correlationId,time,c.organizationId]);
 const payload={attempt_id:p.attempt_id,assignment_id:p.assignment_id,from_agent_id:p.assigned_agent_id,agent_id:c.actor.id,
  instruction_id:item.instruction_id,acknowledgement_command_id:acknowledgement};
 const envelope={event_id:event,event_type:'delivery.assignment_changed',schema_version:1,organization_id:c.organizationId,franchise_id:c.permittedFranchiseIds[0],
  aggregate_type:'parcel',aggregate_id:p.id,aggregate_version:p.version+1,occurred_at:time.toISOString(),actor:{type:'user',id:c.actor.id},
  correlation_id:c.correlationId,causation_id:command,command_id:command,payload};
 await scopedQuery(scope,['custody.acknowledge'],`INSERT INTO shipit.domain_events(event_id,organization_id,franchise_id,booking_id,parcel_id,command_id,parcel_command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
  SELECT $1,{{organization}},$2,$3,$4,$5,$5,'delivery.assignment_changed',$4,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
  [event,c.permittedFranchiseIds[0],p.booking_id,p.id,command,envelope,time,p.version+1,c.organizationId]);
 await scopedQuery(scope,['custody.acknowledge'],`UPDATE shipit.parcel_commands pc SET state='committed',http_status=200,result=$2,committed_at=$3,
  retain_until=$3::timestamptz+interval '24 hours' WHERE {{franchise:pc.organization_id:pc.franchise_id}} AND pc.id=$1 AND pc.state='reserved'`,
  [command,{parcel_id:p.id,version:p.version+1,agent_id:c.actor.id},time]);
 p.version++;p.assigned_agent_id=c.actor.id;p.attempt_agent_id=c.actor.id;
}
