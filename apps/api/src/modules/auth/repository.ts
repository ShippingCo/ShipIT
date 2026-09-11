import { randomUUID } from 'node:crypto';
import { withTransaction, type DatabasePool, type QueryExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import type { Channel } from './validation.ts';

export interface User { id: string; lifecycle: string; auth_version: string }
export interface Session { id: string; user_id: string; auth_version: string; authenticated_at: Date; idle_expires_at: Date; expires_at: Date }
export interface Challenge {
  id: string; user_id: string | null; auth_version: string | null; binding_hash: string;
  purpose: 'login' | 'link'; session_id: string | null; channel: Channel; address: string;
  verifier: string; key_version: string; payload: string | null; failures: number; resends: number;
  expires_at: Date; consumed_at: Date | null; last_sent_at: Date;
}
export class AuthRepository {
  readonly db: QueryExecutor;
  readonly correlationId: string;
  constructor(db: QueryExecutor, correlationId: string = randomUUID()) { this.db=db; this.correlationId=correlationId; }
  async now() { return (await this.db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now; }
  async user(id: string, lock = false) {
    return (await this.db.query<User>(`SELECT id,lifecycle,auth_version FROM shipit.auth_users WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  }
  async lookup(channel: Channel, address: string) {
    return (await this.db.query<User>(`SELECT u.id,u.lifecycle,u.auth_version FROM shipit.auth_users u
      JOIN shipit.auth_identifiers i ON i.user_id=u.id WHERE i.channel=$1 AND i.address=$2`, [channel, address])).rows[0];
  }
  async provision(channel: Channel, address: string) {
    const id = randomUUID();
    await this.db.query('INSERT INTO shipit.auth_users(id) VALUES($1)', [id]);
    await this.addIdentifier(id, channel, address); await this.event(id, 'provision'); return id;
  }
  async addIdentifier(userId: string, channel: Channel, address: string) {
    const row = (await this.db.query(`INSERT INTO shipit.auth_identifiers(id,user_id,channel,address) VALUES($1,$2,$3,$4)
      ON CONFLICT(channel,address) DO NOTHING RETURNING id`, [randomUUID(), userId, channel, address])).rows[0];
    if (!row) throw new HttpError('ACTION_FORBIDDEN');
  }
  async identifiers(userId: string) {
    return (await this.db.query<{ id: string; channel: Channel; address: string }>(
      'SELECT id,channel,address FROM shipit.auth_identifiers WHERE user_id=$1 ORDER BY id', [userId])).rows;
  }
  async removeIdentifier(userId: string, id: string) {
    return (await this.db.query('DELETE FROM shipit.auth_identifiers WHERE user_id=$1 AND id=$2 RETURNING id', [userId, id])).rows.length > 0;
  }
  async event(userId: string, action: string, sessionId: string | null = null) {
    await this.db.query('INSERT INTO shipit.auth_security_events(id,user_id,action,session_id,correlation_id) VALUES($1,$2,$3,$4,$5)', [randomUUID(), userId, action, sessionId,this.correlationId]);
  }
  // Identity-only denial adapter: never look up the submitted target or tenant.
  async denial(actor:{type:'user'|'anonymous';id:string},action:string,resourceType:string,reason:string,correlationId:string) {
    await this.db.query('SELECT shipit.append_security_denial($1,$2,$3,$4,$5,$6)',
      [actor.type,actor.id,action,resourceType,reason,correlationId]);
  }
  async hit(bucket: string, seconds: number, maximum: number) {
    const row = (await this.db.query<{ hits: number }>(`INSERT INTO shipit.auth_rate_limits(bucket,hits,expires_at)
      VALUES($1,1,clock_timestamp()+$2*interval '1 second') ON CONFLICT(bucket) DO UPDATE SET
      hits=CASE WHEN shipit.auth_rate_limits.expires_at<=clock_timestamp() THEN 1 ELSE LEAST(shipit.auth_rate_limits.hits+1,1000000) END,
      expires_at=CASE WHEN shipit.auth_rate_limits.expires_at<=clock_timestamp() THEN clock_timestamp()+$2*interval '1 second' ELSE shipit.auth_rate_limits.expires_at END
      RETURNING hits`, [bucket, seconds])).rows[0]!;
    return row.hits <= maximum;
  }
  async insertChallenge(c: Challenge) {
    await this.db.query(`INSERT INTO shipit.auth_challenges(id,user_id,auth_version,binding_hash,purpose,session_id,channel,address,verifier,key_version,payload,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [c.id,c.user_id,c.auth_version,c.binding_hash,c.purpose,c.session_id,c.channel,c.address,c.verifier,c.key_version,c.payload,c.expires_at]);
  }
  async challenge(id: string, lock = false) {
    return (await this.db.query<Challenge>(`SELECT * FROM shipit.auth_challenges WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  }
  async fail(id: string) { await this.db.query('UPDATE shipit.auth_challenges SET failures=LEAST(failures+1,5) WHERE id=$1', [id]); }
  async consume(id: string) { await this.db.query('UPDATE shipit.auth_challenges SET consumed_at=clock_timestamp(),payload=NULL WHERE id=$1', [id]); }
  async resend(id: string) { await this.db.query('UPDATE shipit.auth_challenges SET resends=resends+1,last_sent_at=clock_timestamp() WHERE id=$1', [id]); }
  async enqueue(challengeId: string) { await this.db.query('INSERT INTO shipit.auth_delivery_jobs(id,challenge_id) VALUES($1,$2)', [randomUUID(),challengeId]); }
  async newSession(user: User, hash: string) {
    return (await this.db.query<Session>(`INSERT INTO shipit.auth_sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '12 hours') RETURNING *`, [randomUUID(),user.id,hash,user.auth_version])).rows[0]!;
  }
  async session(hash: string, lock = false) {
    return (await this.db.query<Session>(`SELECT s.id,s.user_id,s.auth_version,s.authenticated_at,s.idle_expires_at,s.expires_at
      FROM shipit.auth_sessions s JOIN shipit.auth_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND u.lifecycle='active' AND u.auth_version=s.auth_version ${lock ? 'FOR SHARE OF s,u' : ''}`, [hash])).rows[0];
  }
  async activity(id: string) {
    await this.db.query(`UPDATE shipit.auth_sessions SET idle_expires_at=LEAST(expires_at,clock_timestamp()+interval '30 minutes')
      WHERE id=$1 AND revoked_at IS NULL AND idle_expires_at>clock_timestamp() AND expires_at>clock_timestamp()`, [id]);
  }
  async revokeSession(id: string) { await this.db.query('UPDATE shipit.auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL', [id]); }
  async revokeAll(id: string, lifecycle?: 'active' | 'disabled') {
    await this.db.query('UPDATE shipit.auth_users SET auth_version=auth_version+1,lifecycle=COALESCE($2,lifecycle) WHERE id=$1', [id,lifecycle ?? null]);
  }
}
export async function authTransaction<T>(pool: DatabasePool, work: (repo: AuthRepository) => Promise<T>, correlationId?:string): Promise<T> {
  let domainError: HttpError | undefined;
  try {
    return await withTransaction(pool, async tx => {
      try { return await work(new AuthRepository(tx,correlationId)); }
      catch (error) { if (error instanceof HttpError) domainError = error; throw error; }
    });
  } catch { throw domainError ?? new HttpError('TEMPORARILY_UNAVAILABLE'); }
}
