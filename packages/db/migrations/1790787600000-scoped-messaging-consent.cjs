// Additive, forward-only. No prototype opt-in or phone-based consent backfill.
exports.up = pgm => { pgm.sql(String.raw`
ALTER TABLE shipit.customers ADD COLUMN contact_version uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE shipit.customers ADD COLUMN contact_changed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(contact_changed_at));
-- Before contact generations existed, updated_at is the conservative known boundary.
UPDATE shipit.customers SET contact_changed_at=updated_at;
CREATE FUNCTION shipit.rotate_customer_contact() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.phone_normalized IS DISTINCT FROM OLD.phone_normalized THEN NEW.contact_version:=gen_random_uuid();NEW.contact_changed_at:=clock_timestamp();
 ELSIF NEW.contact_version IS DISTINCT FROM OLD.contact_version OR NEW.contact_changed_at IS DISTINCT FROM OLD.contact_changed_at THEN
  RAISE EXCEPTION 'CONTACT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER customers_contact_identity BEFORE UPDATE ON shipit.customers FOR EACH ROW EXECUTE FUNCTION shipit.rotate_customer_contact();

CREATE TABLE shipit.whatsapp_consent_disclosures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 installation_id uuid NOT NULL, customer_id uuid NOT NULL, contact_version uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key ~ '^[a-f0-9]{64}$'),
 message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200),
 purpose text NOT NULL CHECK(purpose='updates'), policy_version text NOT NULL CHECK(policy_version='whatsapp-consent-v1'),
 disclosure_hash text NOT NULL CHECK(disclosure_hash ~ '^[a-f0-9]{64}$'),
 disclosed_at timestamptz NOT NULL CHECK(isfinite(disclosed_at)), expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>disclosed_at),
 UNIQUE(installation_id,message_id), UNIQUE(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id)
);
CREATE TABLE shipit.whatsapp_consent_receipts (
 inbox_id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 customer_id uuid, contact_version uuid, contact_key text CHECK(contact_key ~ '^[a-f0-9]{64}$'),
 intent text NOT NULL CHECK(intent IN ('stop','start','other','unavailable')),
 outcome text NOT NULL CHECK(outcome IN ('granted','revoked','unchanged','disclosure_required','contact_ambiguous','source_stale','source_invalid','key_unavailable','owner_disabled')),
 source text NOT NULL DEFAULT 'signed_webhook' CHECK(source='signed_webhook'),
 purpose text NOT NULL DEFAULT 'updates' CHECK(purpose='updates'), channel text NOT NULL DEFAULT 'whatsapp' CHECK(channel='whatsapp'),
 policy_version text NOT NULL CHECK(policy_version='whatsapp-consent-v1'), disclosure_id uuid,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 correlation_id uuid NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,disclosure_id) REFERENCES shipit.whatsapp_consent_disclosures(organization_id,franchise_id,id),
 CHECK((customer_id IS NULL)=(contact_version IS NULL))
);
CREATE INDEX whatsapp_consent_history ON shipit.whatsapp_consent_receipts(organization_id,franchise_id,customer_id,recorded_at DESC,inbox_id);
CREATE INDEX whatsapp_consent_unresolved ON shipit.whatsapp_consent_receipts(installation_id,outcome);
CREATE TABLE shipit.whatsapp_consent_state (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, installation_id uuid NOT NULL,
 contact_key text NOT NULL CHECK(contact_key ~ '^[a-f0-9]{64}$'), customer_id uuid, contact_version uuid,
 purpose text NOT NULL DEFAULT 'updates' CHECK(purpose='updates'), channel text NOT NULL DEFAULT 'whatsapp' CHECK(channel='whatsapp'),
 state text NOT NULL CHECK(state IN ('unknown','granted','revoked')), version integer NOT NULL CHECK(version>0),
 last_change_at timestamptz, last_inbound_at timestamptz NOT NULL CHECK(isfinite(last_inbound_at)),
 last_inbox_id uuid NOT NULL, policy_version text NOT NULL CHECK(policy_version='whatsapp-consent-v1'),
 PRIMARY KEY(installation_id,contact_key),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,last_inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 CHECK((customer_id IS NULL)=(contact_version IS NULL))
);
CREATE TRIGGER whatsapp_consent_receipts_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_consent_receipts FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER whatsapp_consent_disclosures_immutable BEFORE UPDATE OR DELETE ON shipit.whatsapp_consent_disclosures FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE INDEX whatsapp_inbound_consent ON shipit.whatsapp_inbox(installation_id,received_at,id) WHERE kind='inbound';

-- The short transaction owns the source row; concurrent workers cannot consume it twice.
CREATE FUNCTION shipit.whatsapp_consent_next() RETURNS TABLE(organization_id uuid,franchise_id uuid,inbox_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT j.organization_id,j.franchise_id,j.id FROM shipit.whatsapp_inbox j
 WHERE j.kind='inbound' AND j.state='completed' AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r WHERE r.inbox_id=j.id)
 ORDER BY j.received_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
$fn$;

CREATE FUNCTION shipit.whatsapp_consent_apply(org uuid,franchise uuid,job uuid,phone text,contact text,command text,reply text,policy text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE j shipit.whatsapp_inbox; i shipit.whatsapp_installations; c shipit.customers;
 prior shipit.whatsapp_consent_state; disclosure shipit.whatsapp_consent_disclosures;
 result text; next_state text; matches integer; changed boolean:=false; valid_owner boolean;
BEGIN
 IF policy IS DISTINCT FROM 'whatsapp-consent-v1' OR command IS NULL OR command NOT IN ('stop','start','other','unavailable')
  OR (command<>'unavailable' AND (phone IS NULL OR phone !~ '^\+[1-9][0-9]{7,14}$' OR contact IS NULL OR contact !~ '^[a-f0-9]{64}$'))
 THEN RAISE EXCEPTION 'CONSENT_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM shipit.whatsapp_inbox x WHERE x.organization_id=org AND x.franchise_id=franchise AND x.id=job FOR UPDATE;
 IF j.id IS NULL OR j.kind<>'inbound' OR j.state<>'completed' THEN RAISE EXCEPTION 'CONSENT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT outcome INTO result FROM shipit.whatsapp_consent_receipts WHERE inbox_id=j.id;
 IF FOUND THEN RETURN result; END IF;
 -- Match membership commands: organization, franchise, installation, then customer.
 -- Taking installation before organization would deadlock an operator policy read.
 PERFORM 1 FROM shipit.organizations x WHERE x.id=org FOR SHARE;
 SELECT f.lifecycle='active' AND o.lifecycle='active' INTO valid_owner FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
 WHERE f.organization_id=org AND f.id=franchise FOR SHARE OF f;
 SELECT * INTO i FROM shipit.whatsapp_installations x WHERE x.organization_id=org AND x.franchise_id=franchise AND x.id=j.installation_id FOR UPDATE;
 result:='unchanged';
 IF command='unavailable' THEN result:='key_unavailable';
 ELSIF i.state<>'validated' OR NOT valid_owner THEN result:='owner_disabled';
 ELSIF j.occurred_at>j.received_at+interval '5 minutes' THEN result:='source_invalid';
 ELSE
  SELECT count(*) INTO matches FROM shipit.customers x WHERE x.organization_id=org AND x.franchise_id=franchise AND x.phone_normalized=phone;
  IF matches=1 THEN
   SELECT * INTO c FROM shipit.customers x WHERE x.organization_id=org AND x.franchise_id=franchise AND x.phone_normalized=phone FOR SHARE;
   IF j.occurred_at<c.contact_changed_at THEN c:=NULL; END IF;
  END IF;
  SELECT * INTO prior FROM shipit.whatsapp_consent_state x WHERE x.installation_id=i.id AND x.contact_key=contact FOR UPDATE;
  next_state:=coalesce(prior.state,'unknown');
  IF command='stop' THEN
   IF prior.last_change_at IS NULL OR j.occurred_at>=prior.last_change_at THEN next_state:='revoked';changed:=true;result:='revoked';
   ELSE result:='source_stale'; END IF;
  ELSIF command='start' THEN
   IF c.id IS NULL THEN result:='contact_ambiguous';
   ELSE
    SELECT * INTO disclosure FROM shipit.whatsapp_consent_disclosures d WHERE d.organization_id=org AND d.franchise_id=franchise
     AND d.installation_id=i.id AND d.customer_id=c.id AND d.contact_version=c.contact_version AND d.contact_key=contact
     AND d.message_id=reply AND d.policy_version=policy AND d.disclosed_at<=j.occurred_at AND d.expires_at>j.occurred_at;
    IF disclosure.id IS NULL THEN result:='disclosure_required';
    ELSIF prior.last_change_at IS NOT NULL AND (j.occurred_at<=prior.last_change_at OR (prior.state='revoked' AND disclosure.disclosed_at<=prior.last_change_at)) THEN result:='source_stale';
    ELSE next_state:='granted';changed:=true;result:='granted'; END IF;
   END IF;
  END IF;
  INSERT INTO shipit.whatsapp_consent_state AS s(organization_id,franchise_id,installation_id,contact_key,customer_id,contact_version,state,version,last_change_at,last_inbound_at,last_inbox_id,policy_version)
  VALUES(org,franchise,i.id,contact,c.id,c.contact_version,next_state,1,CASE WHEN changed THEN j.occurred_at ELSE NULL END,j.occurred_at,j.id,policy)
  ON CONFLICT(installation_id,contact_key) DO UPDATE SET
   customer_id=CASE WHEN changed THEN excluded.customer_id ELSE s.customer_id END,
   contact_version=CASE WHEN changed THEN excluded.contact_version ELSE s.contact_version END,
   state=excluded.state,version=s.version+CASE WHEN changed THEN 1 ELSE 0 END,
   last_change_at=CASE WHEN changed THEN excluded.last_change_at ELSE s.last_change_at END,
   last_inbound_at=greatest(s.last_inbound_at,excluded.last_inbound_at),last_inbox_id=CASE WHEN excluded.last_inbound_at>=s.last_inbound_at THEN excluded.last_inbox_id ELSE s.last_inbox_id END;
 END IF;
 INSERT INTO shipit.whatsapp_consent_receipts(inbox_id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,intent,outcome,policy_version,disclosure_id,occurred_at,correlation_id)
 VALUES(j.id,org,franchise,j.installation_id,c.id,c.contact_version,contact,command,result,policy,disclosure.id,j.occurred_at,j.correlation_id);
 RETURN result;
END $fn$;
REVOKE ALL ON shipit.whatsapp_consent_state,shipit.whatsapp_consent_receipts,shipit.whatsapp_consent_disclosures FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.rotate_customer_contact(),shipit.whatsapp_consent_next(),shipit.whatsapp_consent_apply(uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC;
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'consent:'||inbox_id::text,organization_id,ARRAY[franchise_id],'service','whatsapp-consent-worker',
 'consent.'||intent,'whatsapp_inbox',inbox_id,CASE WHEN outcome IN ('granted','revoked','unchanged') THEN 'success' ELSE 'denied' END,
 outcome,correlation_id,recorded_at,NULL,NULL,NULL::integer,NULL::text FROM shipit.whatsapp_consent_receipts$view$;
END $extend$;
`); };
exports.down = () => { throw new Error('Forward-only migration'); };
