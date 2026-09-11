import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { AuthRepository, authTransaction, type Session, type Challenge } from './repository.ts';
import { digest, equal, mac, otp, seal, secret, type AuthKeys } from './crypto.ts';
import { identifier, uuid, type Channel } from './validation.ts';

function createAuthCore(pool: DatabasePool, keys: AuthKeys, correlationId?:string) {
  const root = new AuthRepository(pool,correlationId);
  const transaction = <T>(work:(repo:AuthRepository)=>Promise<T>)=>authTransaction(pool,work,correlationId);
  async function limit(action: string, identity: string, ip: string, max: number, seconds: number) {
    // Global first bounds arbitrary attacker-generated account/IP bucket storage.
    const permitted = await transaction(async repo => {
      if (!await repo.hit(mac(keys.browser,'limit',action,'global'),60,1000)) return false;
      const source = await repo.hit(mac(keys.browser,'limit',action,'ip',ip),seconds,Math.max(max * 5,20));
      if (!source) return false;
      return repo.hit(mac(keys.browser,'limit',action,'identity',identity),seconds,max);
    });
    if (!permitted) throw new HttpError('RATE_LIMITED');
  }
  async function current(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError('UNAUTHENTICATED');
    let s: Session | undefined;
    try { s = await root.session(digest(token)); } catch { throw new HttpError('TEMPORARILY_UNAVAILABLE'); }
    if (!s) throw new HttpError('UNAUTHENTICATED');
    return s;
  }
  async function readChallenge(id: string) {
    try { return await root.challenge(id); } catch { throw new HttpError('TEMPORARILY_UNAVAILABLE'); }
  }
  async function lockedSession(repo: AuthRepository, token: string, recent = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError('UNAUTHENTICATED');
    const before = await repo.session(digest(token));
    if (!before) throw new HttpError('UNAUTHENTICATED');
    await repo.user(before.user_id,true);
    const s = await repo.session(digest(token));
    if (!s) throw new HttpError('UNAUTHENTICATED');
    if (recent && (await repo.now()).getTime()-s.authenticated_at.getTime() >= 300_000) throw new HttpError('ACTION_FORBIDDEN');
    return s;
  }
  const codeMac = (c: Pick<Challenge,'id'|'purpose'|'channel'|'address'>, code: string) => mac(keys.verifier,'otp',c.id,c.purpose,c.channel,c.address,code);
  function valid(c: Challenge | undefined, binding: string, now: Date): c is Challenge {
    return !!c && equal(c.binding_hash,digest(binding)) && !c.consumed_at && c.failures<5 && c.expires_at>now && c.key_version===keys.version;
  }
  return {
    current,
    // Trusted provisioning boundary only. #17 supplies verified enrollment; never expose as HTTP CRUD.
    async provision(channel: Channel, address: string) {
      const contact=identifier(channel,address);
      return transaction(repo=>repo.provision(contact.channel,contact.address));
    },
    async start(channel: Channel, address: string, binding: string, ip: string, linkToken?: string) {
      const contact=identifier(channel,address);
      await limit('start',`${contact.channel}:${contact.address}`,ip,3,900);
      return transaction(async repo => {
        const s = linkToken ? await lockedSession(repo,linkToken,true) : undefined;
        let user = s ? await repo.user(s.user_id) : await repo.lookup(contact.channel,contact.address);
        if (user) user=await repo.user(user.id,true);
        const id=randomUUID(), code=otp(), now=await repo.now();
        const eligible=user?.lifecycle==='active';
        const c: Challenge={ id,user_id:eligible ? user!.id : null,auth_version:eligible ? user!.auth_version : null,
          binding_hash:digest(binding),purpose:s ? 'link':'login',session_id:s?.id ?? null,
          ...contact,verifier:'',key_version:keys.version,payload:null,failures:0,resends:0,
          last_sent_at:now,expires_at:new Date(now.getTime()+600_000),consumed_at:null };
        c.verifier=codeMac(c,code); c.payload=eligible ? seal(keys,id,code) : null;
        await repo.insertChallenge(c);
        if (eligible) await repo.enqueue(id);
        return { challenge_id:id,expires_in:600,resend_after:60 };
      });
    },
    async resend(idInput: string, binding: string, ip: string) {
      const id=uuid(idInput), before=await readChallenge(id);
      await limit('resend',before ? `${before.channel}:${before.address}` : id,ip,3,900);
      return transaction(async repo => {
        if (before?.user_id) await repo.user(before.user_id,true);
        const c=await repo.challenge(id,true),now=await repo.now();
        if (!valid(c,binding,now) || c.resends>=3 || now.getTime()-c.last_sent_at.getTime()<60_000) throw new HttpError('ACTION_FORBIDDEN');
        await repo.resend(id);
        const u=c.user_id ? await repo.user(c.user_id) : undefined;
        if (c.payload && u?.lifecycle==='active' && u.auth_version===c.auth_version) await repo.enqueue(id);
        return { resend_after:60 };
      });
    },
    async verify(idInput: string, code: string, binding: string, ip: string, linkToken?: string, oldToken?: string) {
      const id=uuid(idInput), before=await readChallenge(id);
      await limit('verify',before ? `${before.channel}:${before.address}` : id,ip,10,900);
      const result=await transaction(async repo => {
        const user=before?.user_id ? await repo.user(before.user_id,true) : undefined;
        const c=await repo.challenge(id,true),now=await repo.now();
        if (!valid(c,binding,now)) return null;
        const accepted=/^[0-9]{8}$/.test(code) && equal(c.verifier,codeMac(c,code)) &&
          user?.lifecycle==='active' && user.auth_version===c.auth_version;
        if (!accepted) { await repo.fail(id); return null; }
        if (c.purpose==='link') {
          if (!linkToken) return null;
          const s=await repo.session(digest(linkToken));
          if (!s || s.id!==c.session_id || s.user_id!==user.id || now.getTime()-s.authenticated_at.getTime()>=300_000) return null;
          await repo.addIdentifier(user.id,c.channel,c.address); await repo.consume(id); await repo.event(user.id,'link',s.id);
          return { linked:true as const };
        }
        await repo.consume(id);
        if (oldToken) {
          const old=await repo.session(digest(oldToken));
          if (old?.user_id===user.id) await repo.revokeSession(old.id);
        }
        const token=secret(),session=await repo.newSession(user,digest(token));
        await repo.event(user.id,'login',session.id);
        return { linked:false as const,token,session };
      });
      if (!result) throw new HttpError('UNAUTHENTICATED');
      return result;
    },
    async logout(token: string) {
      // Invalid/already revoked logout is idempotent; outage still fails visibly.
      return transaction(async repo=>{
        const s=await repo.session(digest(token));
        if (!s) return;
        await repo.user(s.user_id,true); await repo.revokeSession(s.id); await repo.event(s.user_id,'logout',s.id);
      });
    },
    async logoutAll(token: string) {
      return transaction(async repo=>{ const s=await lockedSession(repo,token,true); await repo.revokeAll(s.user_id); await repo.event(s.user_id,'revoke_all',s.id); });
    },
    async activity(token: string) {
      return transaction(async repo=>{ const s=await lockedSession(repo,token); await repo.activity(s.id); });
    },
    async contacts(token: string) {
      return transaction(async repo=>{const s=await lockedSession(repo,token);return repo.identifiers(s.user_id);});
    },
    async unlink(token: string,idInput: string) {
      const id=uuid(idInput);
      return transaction(async repo=>{
        const s=await lockedSession(repo,token,true), contacts=await repo.identifiers(s.user_id);
        if (contacts.length<=1 || !contacts.some(c=>c.id===id)) throw new HttpError('ACTION_FORBIDDEN');
        await repo.removeIdentifier(s.user_id,id); await repo.revokeAll(s.user_id); await repo.event(s.user_id,'unlink',s.id);
      });
    },
    // Internal service capability: no public global-admin route or tenant role inference.
    async changeAccount(userId: string,lifecycle: 'active'|'disabled') {
      const id=uuid(userId);
      return transaction(async repo=>{
        if (!await repo.user(id,true)) throw new HttpError('RESOURCE_NOT_FOUND');
        await repo.revokeAll(id,lifecycle); await repo.event(id,lifecycle==='active'?'enable':'disable');
      });
    },
  };
}
export type AuthService=ReturnType<typeof createAuthService>;

export function createAuthService(pool:DatabasePool,keys:AuthKeys) {
  return {...createAuthCore(pool,keys),withCorrelation:(id:string)=>createAuthCore(pool,keys,id)};
}
