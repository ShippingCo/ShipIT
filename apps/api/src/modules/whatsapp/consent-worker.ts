import { createHmac } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withNextConsentScope } from '../security/jobs.ts';
import { scopedQuery } from '../security/scope.ts';
import { openInboxPayload, type BusinessWebhookConfig, type InboxInput } from './webhook-payload.ts';
import { consentIntent, consentPolicyVersion } from './consent-rules.ts';

export function consentContactKey(config: BusinessWebhookConfig, installation: string, phone: string) {
  return createHmac('sha256', Buffer.from(config.fingerprint_key, 'hex'))
    .update(JSON.stringify(['consent-contact-v1', installation, phone])).digest('hex');
}
export function createConsentWorker(database: DatabasePool, config: BusinessWebhookConfig) {
  return { async tick() {
    return withNextConsentScope(database, async (scope, id) => {
      const row = (await scopedQuery<InboxInput & { installation_id: string }>(scope, ['whatsapp.consent.work'],
        `SELECT j.*,i.waba_id,i.phone_number_id FROM shipit.whatsapp_inbox j
         JOIN shipit.whatsapp_installations i ON i.organization_id=j.organization_id AND i.franchise_id=j.franchise_id AND i.id=j.installation_id
         WHERE {{franchise:j.organization_id:j.franchise_id}} AND {{franchise:i.organization_id:i.franchise_id}} AND j.id=$1`, [id])).rows[0]!;
      let phone: string | null = null, contact: string | null = null, intent = 'unavailable', reply: string | null = null;
      try {
        const payload = openInboxPayload(config, row) as { from: string; text: string; context_id?: string };
        if (!/^[1-9][0-9]{7,14}$/.test(payload.from) || typeof payload.text !== 'string') throw new Error('INVALID_INBOX');
        phone = '+' + payload.from;
        contact = consentContactKey(config, row.installation_id, phone);
        intent = consentIntent(payload.text);
        reply = payload.context_id ?? null;
      } catch { /* Preserve only a controlled outcome; ciphertext and errors never reach logs. */ }
      return (await scopedQuery<{result: string}>(scope, ['whatsapp.consent.work'],
        `SELECT shipit.whatsapp_consent_apply($1,$2,$3,$4,$5,$6,$7,$8) AS result WHERE {{franchise:$1:$2}}`,
        [scope.context.organizationId, scope.context.permittedFranchiseIds[0], id, phone, contact, intent, reply, consentPolicyVersion])).rows[0]!.result;
    });
  } };
}
