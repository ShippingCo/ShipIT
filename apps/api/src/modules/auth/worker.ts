import type { DatabasePool } from '@shippingco/db';
import { authTransaction, type Challenge } from './repository.ts';
import { unseal, type AuthKeys } from './crypto.ts';
import type { SendCode } from './delivery.ts';

export function createDeliveryWorker(pool: DatabasePool, keys: AuthKeys, send: SendCode) {
  async function tick() {
    // Commit claim before network I/O. A crashed claim becomes uncertain, never silently resent.
    const job=await authTransaction(pool,async repo=>{
      await repo.db.query(`UPDATE shipit.auth_delivery_jobs SET state='uncertain',finished_at=clock_timestamp()
        WHERE state='sending' AND claimed_at<clock_timestamp()-interval '1 minute'`);
      return (await repo.db.query<{id:string;challenge_id:string}>(`UPDATE shipit.auth_delivery_jobs SET state='sending',claimed_at=clock_timestamp()
        WHERE id=(SELECT id FROM shipit.auth_delivery_jobs WHERE state='pending' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id,challenge_id`)).rows[0];
    });
    if (!job) return false;
    const c=(await pool.query<Challenge>(`SELECT c.* FROM shipit.auth_challenges c JOIN shipit.auth_users u ON u.id=c.user_id
      WHERE c.id=$1 AND c.consumed_at IS NULL AND c.failures<5 AND c.expires_at>clock_timestamp()
      AND u.lifecycle='active' AND u.auth_version=c.auth_version`,[job.challenge_id])).rows[0];
    let result: {state:string;reference?:string}={state:'expired'};
    if (c?.payload && c.key_version===keys.version) {
      try { result=await send({id:job.id,channel:c.channel,address:c.address,code:unseal(keys,c.id,c.payload)}); }
      catch { result={state:'uncertain'}; }
    }
    await pool.query(`UPDATE shipit.auth_delivery_jobs SET state=$2,provider_ref=$3,finished_at=clock_timestamp() WHERE id=$1 AND state='sending'`,[job.id,result.state,result.reference ?? null]);
    return true;
  }
  async function cleanup() {
    // Bounded maintenance. Retain audit facts; dispose contact/code-bearing challenges after one day.
    await pool.query(`UPDATE shipit.auth_challenges SET payload=NULL WHERE id IN
      (SELECT id FROM shipit.auth_challenges WHERE payload IS NOT NULL AND expires_at<=clock_timestamp() LIMIT 500)`);
    await pool.query(`DELETE FROM shipit.auth_delivery_jobs WHERE id IN (SELECT j.id FROM shipit.auth_delivery_jobs j
      JOIN shipit.auth_challenges c ON c.id=j.challenge_id WHERE c.expires_at<clock_timestamp()-interval '1 day' LIMIT 500)`);
    await pool.query(`DELETE FROM shipit.auth_challenges WHERE id IN (SELECT c.id FROM shipit.auth_challenges c
      WHERE c.expires_at<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM shipit.auth_delivery_jobs j WHERE j.challenge_id=c.id) LIMIT 500)`);
    await pool.query(`DELETE FROM shipit.auth_sessions WHERE id IN (SELECT s.id FROM shipit.auth_sessions s
      WHERE s.expires_at<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM shipit.auth_challenges c WHERE c.session_id=s.id) LIMIT 500)`);
    await pool.query(`DELETE FROM shipit.auth_rate_limits WHERE bucket IN (SELECT bucket FROM shipit.auth_rate_limits WHERE expires_at<clock_timestamp() LIMIT 500)`);
  }
  return {tick,cleanup};
}
