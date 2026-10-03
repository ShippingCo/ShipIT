import { randomUUID } from 'node:crypto';
import { withTransaction } from '../src/index.ts';
import type { DisposableDatabase } from './support.ts';

/** Seed the released pre-#60 shape, without asking new code to run on old schema. */
export async function legacyCarrierInstallation(db:DisposableDatabase,input:{organization:string;franchise:string;actor:string;label:string;now:Date}) {
  const id=randomUUID(),command=randomUUID();
  await withTransaction(db.ownerPool(),async tx=>{
    await tx.query(`INSERT INTO shipit.carrier_installations(id,organization_id,franchise_id,courier_id,label,command_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,input.organization,input.franchise,randomUUID(),input.label,command,input.now]);
    await tx.query(`INSERT INTO shipit.carrier_commands(id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,resource_id,version,reason_code,result,correlation_id,occurred_at)
      VALUES($1,$2,$3,$4,'installation',$5,$6,$7,1,'manual_setup',$8,$9,$10)`,
    [command,input.organization,input.franchise,input.actor,'a'.repeat(64),'b'.repeat(64),id,{id,version:1},randomUUID(),input.now]);
  });
  return {id,version:1};
}
