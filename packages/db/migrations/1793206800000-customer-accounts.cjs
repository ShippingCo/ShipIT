// #141 additive debtor accounts. No historical customer grouping or due-date backfill.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.customer_accounts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,debtor_customer_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,debtor_customer_id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id,debtor_customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id)
);
CREATE TABLE shipit.customer_account_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name=btrim(name) AND name !~ '[\x01-\x1f\x7f-\x9f]'),
 shipping_customer_ids uuid[] NOT NULL CHECK(cardinality(shipping_customer_ids) BETWEEN 1 AND 100),
 billing_contact jsonb NOT NULL CHECK((jsonb_typeof(billing_contact)='object' AND octet_length(billing_contact::text)<=2048
 AND billing_contact ?& ARRAY['name','phone','authorization_ref'] AND billing_contact-ARRAY['name','phone','authorization_ref']='{}'::jsonb
 AND jsonb_typeof(billing_contact->'name')='string' AND length(billing_contact->>'name') BETWEEN 1 AND 120
 AND jsonb_typeof(billing_contact->'authorization_ref')='string' AND length(billing_contact->>'authorization_ref') BETWEEN 1 AND 128
 AND billing_contact->>'phone'~'^\+[1-9][0-9]{6,14}$') IS TRUE),
 closing_day integer NOT NULL CHECK(closing_day BETWEEN 1 AND 31),due_days integer NOT NULL CHECK(due_days BETWEEN 0 AND 366),
 credit_limit_paise bigint NOT NULL CHECK(credit_limit_paise BETWEEN 0 AND 9007199254740991),
 state text NOT NULL CHECK(state IN ('active','held')),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 256),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,account_id,id),
 UNIQUE(organization_id,franchise_id,account_id,version),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.customer_accounts(organization_id,franchise_id,id)
);
CREATE INDEX customer_account_current ON shipit.customer_account_revisions(organization_id,franchise_id,account_id,version DESC);
CREATE TABLE shipit.customer_account_customer_links (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,revision_id uuid NOT NULL,customer_id uuid NOT NULL,
 PRIMARY KEY(organization_id,franchise_id,revision_id,customer_id),
 FOREIGN KEY(organization_id,franchise_id,revision_id) REFERENCES shipit.customer_account_revisions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.valid_customer_account_rules(rules jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE rule jsonb;field text;
BEGIN
 IF jsonb_typeof(rules) IS DISTINCT FROM 'array' OR jsonb_array_length(rules) NOT BETWEEN 1 AND 100 OR octet_length(rules::text)>65536 THEN RETURN false;END IF;
 FOR rule IN SELECT value FROM jsonb_array_elements(rules) LOOP
  IF (jsonb_typeof(rule)='object' AND rule ?& ARRAY['destination_key','service','min_weight_grams','max_weight_grams','freight_paise','packing_paise']
   AND rule-ARRAY['destination_key','service','min_weight_grams','max_weight_grams','freight_paise','packing_paise']='{}'::jsonb
   AND jsonb_typeof(rule->'destination_key')='string' AND rule->>'destination_key'~'^[A-Z][A-Z0-9_]{0,31}$'
   AND rule->>'service' IN ('standard','express','same_city')) IS NOT TRUE THEN RETURN false;END IF;
  FOREACH field IN ARRAY ARRAY['min_weight_grams','max_weight_grams','freight_paise','packing_paise'] LOOP
   IF field='max_weight_grams' AND rule->field='null'::jsonb THEN CONTINUE;END IF;
   IF jsonb_typeof(rule->field) IS DISTINCT FROM 'number' THEN RETURN false;END IF;
   IF (rule->>field)::numeric<>trunc((rule->>field)::numeric) OR (rule->>field)::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RETURN false;END IF;
  END LOOP;
  IF (rule->>'min_weight_grams')::numeric<1 OR (rule->>'max_weight_grams')::numeric<=(rule->>'min_weight_grams')::numeric
   OR (rule->>'freight_paise')::numeric+(rule->>'packing_paise')::numeric>9007199254740991 THEN RETURN false;END IF;
 END LOOP;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rules) WITH ORDINALITY a(rule,i),jsonb_array_elements(rules) WITH ORDINALITY b(rule,i)
  WHERE a.i<b.i AND a.rule->>'destination_key'=b.rule->>'destination_key' AND a.rule->>'service'=b.rule->>'service'
  AND (b.rule->'max_weight_grams'='null'::jsonb OR (a.rule->>'min_weight_grams')::numeric<(b.rule->>'max_weight_grams')::numeric)
  AND (a.rule->'max_weight_grams'='null'::jsonb OR (b.rule->>'min_weight_grams')::numeric<(a.rule->>'max_weight_grams')::numeric));
END $fn$;
CREATE TABLE shipit.customer_account_rates (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 effective_from timestamptz NOT NULL CHECK(isfinite(effective_from)),effective_to timestamptz NOT NULL CHECK(isfinite(effective_to) AND effective_to>effective_from),
 approval_ref text NOT NULL CHECK(length(approval_ref) BETWEEN 1 AND 128),
 rules jsonb NOT NULL CHECK(shipit.valid_customer_account_rules(rules)),
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),recorded_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,account_id,id),
 UNIQUE(organization_id,franchise_id,account_id,version),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.customer_accounts(organization_id,franchise_id,id)
);
CREATE INDEX customer_account_rate_effective ON shipit.customer_account_rates(organization_id,franchise_id,account_id,effective_from DESC,version DESC);
CREATE TABLE shipit.customer_account_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('customer_accounts.configure','customer_accounts.rates','customer_accounts.approve','customer_accounts.request')),
 version integer NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),correlation_id uuid NOT NULL,occurred_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.customer_accounts(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.guard_customer_account_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_GENERATED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role='franchise_admin' AND m.lifecycle='active')
 THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_SCOPE' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='customer_account_revisions' THEN
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
 ELSE
  SELECT COALESCE(max(version),0) INTO previous FROM shipit.customer_account_rates WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id;
  IF NEW.effective_from<date_trunc('milliseconds',clock_timestamp()) THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_RATE_PAST' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_VERSION' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
END $fn$;
CREATE TRIGGER customer_account_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.customer_account_revisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_customer_account_history();
CREATE TRIGGER customer_account_rate_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.customer_account_rates FOR EACH ROW EXECUTE FUNCTION shipit.guard_customer_account_history();
CREATE TRIGGER customer_account_immutable BEFORE UPDATE OR DELETE ON shipit.customer_accounts FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER customer_account_audit_immutable BEFORE UPDATE OR DELETE ON shipit.customer_account_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER customer_account_links_immutable BEFORE UPDATE OR DELETE ON shipit.customer_account_customer_links FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.audit_customer_account_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_TABLE_NAME='customer_account_revisions' THEN
  INSERT INTO shipit.customer_account_customer_links SELECT NEW.organization_id,NEW.franchise_id,NEW.id,c FROM unnest(NEW.shipping_customer_ids) c;
 END IF;
 INSERT INTO shipit.customer_account_audit_events VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.account_id,
 CASE WHEN TG_TABLE_NAME='customer_account_revisions' THEN 'customer_accounts.configure' ELSE 'customer_accounts.rates' END,
 NEW.version,NEW.actor_id,NEW.correlation_id,NEW.recorded_at);RETURN NULL;
END $fn$;
CREATE TRIGGER customer_account_revision_audit AFTER INSERT ON shipit.customer_account_revisions FOR EACH ROW EXECUTE FUNCTION shipit.audit_customer_account_history();
CREATE TRIGGER customer_account_rate_audit AFTER INSERT ON shipit.customer_account_rates FOR EACH ROW EXECUTE FUNCTION shipit.audit_customer_account_history();
CREATE FUNCTION shipit.check_customer_account_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.id AND version=1)
 THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_INCOMPLETE' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER customer_account_complete AFTER INSERT ON shipit.customer_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_customer_account_complete();
DO $extend$
DECLARE source text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'customer-account:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,
 action,'customer_account',account_id,'success','account_revision',correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.customer_account_audit_events$view$;
END $extend$;
REVOKE ALL ON shipit.customer_accounts,shipit.customer_account_revisions,shipit.customer_account_rates,shipit.customer_account_audit_events,shipit.customer_account_customer_links FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_customer_account_history(),shipit.audit_customer_account_history(),shipit.check_customer_account_complete() FROM PUBLIC;
-- Preserve the ordinary rule FK; negotiated quotes instead reference their immutable account revision.
ALTER TABLE shipit.pricing_quotes ALTER COLUMN rule_id DROP NOT NULL;
ALTER TABLE shipit.pricing_quotes ADD COLUMN account_rate_id uuid,
 ADD FOREIGN KEY(organization_id,franchise_id,version_id) REFERENCES shipit.pricing_versions(organization_id,franchise_id,id),
 ADD FOREIGN KEY(organization_id,franchise_id,account_rate_id) REFERENCES shipit.customer_account_rates(organization_id,franchise_id,id),
 ADD CHECK((rule_id IS NULL)=(account_rate_id IS NOT NULL));
DO $quote$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='shipit.pricing_quotes'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%octet_length%' LOOP
  EXECUTE format('ALTER TABLE shipit.pricing_quotes DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $quote$;
ALTER TABLE shipit.pricing_quotes ADD CONSTRAINT pricing_quote_evidence CHECK((
 jsonb_typeof(result)='object' AND octet_length(result::text)<=8192 AND result->>'id'=id::text
 AND result->>'rate_version_id'=version_id::text AND (result->>'rule_id') IS NOT DISTINCT FROM rule_id::text
 AND (result->'account'->>'rate_revision_id') IS NOT DISTINCT FROM account_rate_id::text
 AND result ?& ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown']
 AND result-ARRAY['id','proposal','card_id','rate_version_id','rate_version_number','rule_id','policy','inputs','freight_suggestion_paise','packing_paise','freight_paise','variance_paise','override_status','approval_actor_id','subtotal_paise','created_at','expires_at','fingerprint','breakdown','account']='{}'::jsonb
 AND (NOT(result ? 'account') OR ((result->'account'->>'id')=(result->'inputs'->>'customer_account_id') AND (result->'account'->>'rate_source')=CASE WHEN account_rate_id IS NULL THEN 'normal' ELSE 'account' END))
) IS TRUE);
CREATE FUNCTION shipit.guard_account_quote_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE chosen_account uuid;revision shipit.customer_account_revisions;
BEGIN
 IF (NEW.result->'inputs' ? 'customer_account_id') IS DISTINCT FROM (NEW.result ? 'account') THEN RAISE EXCEPTION 'ACCOUNT_QUOTE_REQUIRED' USING ERRCODE='23514';END IF;
 IF NEW.result ? 'account' THEN
  chosen_account:=(NEW.result->'inputs'->>'customer_account_id')::uuid;
  PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=chosen_account FOR UPDATE;
  SELECT * INTO revision FROM shipit.customer_account_revisions cr WHERE cr.organization_id=NEW.organization_id AND cr.franchise_id=NEW.franchise_id AND cr.account_id=chosen_account ORDER BY version DESC LIMIT 1;
  IF revision.id IS NULL OR revision.state<>'active' OR NEW.result->'account'->>'revision_id' IS DISTINCT FROM revision.id::text OR (NEW.result->'account'->>'version')::integer IS DISTINCT FROM revision.version
  OR NEW.account_rate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.customer_account_rates ar WHERE ar.organization_id=NEW.organization_id AND ar.franchise_id=NEW.franchise_id AND ar.account_id=revision.account_id AND ar.id=NEW.account_rate_id AND ar.effective_from<=NEW.created_at AND ar.effective_to>NEW.created_at)
  THEN RAISE EXCEPTION 'ACCOUNT_QUOTE_SOURCE' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $fn$;
CREATE TRIGGER account_quote_evidence BEFORE INSERT ON shipit.pricing_quotes FOR EACH ROW EXECUTE FUNCTION shipit.guard_account_quote_evidence();
REVOKE ALL ON FUNCTION shipit.guard_account_quote_evidence() FROM PUBLIC;
CREATE TABLE shipit.customer_credit_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,operator_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 booking_intent jsonb NOT NULL CHECK(jsonb_typeof(booking_intent)='object' AND octet_length(booking_intent::text)<=65536),
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,operator_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id) REFERENCES shipit.customer_accounts(organization_id,franchise_id,id)
);
CREATE TRIGGER customer_credit_request_immutable BEFORE UPDATE OR DELETE ON shipit.customer_credit_requests FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TABLE shipit.customer_credit_approvals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,account_revision_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),operator_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 intent_fingerprint text NOT NULL CHECK(intent_fingerprint~'^[a-f0-9]{64}$'),
 booking_fingerprint text NOT NULL CHECK(booking_fingerprint~'^[a-f0-9]{64}$'),amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 256),expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 quote_id uuid NOT NULL,tax_calculation_id uuid NOT NULL,request_id uuid UNIQUE,
 key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,account_id,account_revision_id) REFERENCES shipit.customer_account_revisions(organization_id,franchise_id,account_id,id),
 FOREIGN KEY(organization_id,franchise_id,quote_id) REFERENCES shipit.pricing_quotes(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,tax_calculation_id) REFERENCES shipit.tax_calculations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,request_id) REFERENCES shipit.customer_credit_requests(organization_id,franchise_id,id)
);
CREATE TABLE shipit.customer_account_bookings (
 booking_id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,account_id uuid NOT NULL,account_revision_id uuid NOT NULL,
 debtor_customer_id uuid NOT NULL,rate_revision_id uuid,approval_id uuid UNIQUE,due_date date NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=8192),
 UNIQUE(organization_id,franchise_id,booking_id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,account_id,account_revision_id) REFERENCES shipit.customer_account_revisions(organization_id,franchise_id,account_id,id),
 FOREIGN KEY(organization_id,franchise_id,account_id,rate_revision_id) REFERENCES shipit.customer_account_rates(organization_id,franchise_id,account_id,id),
 FOREIGN KEY(organization_id,franchise_id,debtor_customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,approval_id) REFERENCES shipit.customer_credit_approvals(organization_id,franchise_id,id)
);
CREATE INDEX customer_account_credit_sources ON shipit.customer_account_bookings(organization_id,franchise_id,account_id,due_date,booking_id);
CREATE TRIGGER customer_credit_approval_immutable BEFORE UPDATE OR DELETE ON shipit.customer_credit_approvals FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE TRIGGER customer_account_booking_immutable BEFORE UPDATE OR DELETE ON shipit.customer_account_bookings FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();
CREATE FUNCTION shipit.guard_customer_credit_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q shipit.pricing_quotes;t shipit.tax_calculations;r shipit.customer_account_revisions;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active'
 WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role='franchise_admin' AND m.lifecycle='active')
 THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.operator_id AND m.role='operator' AND m.lifecycle='active') THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_OPERATOR' USING ERRCODE='42501';END IF;
 IF NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shipit.customer_credit_requests req WHERE req.organization_id=NEW.organization_id AND req.franchise_id=NEW.franchise_id AND req.id=NEW.request_id AND req.operator_id=NEW.operator_id AND req.account_id=NEW.account_id AND req.fingerprint=NEW.intent_fingerprint AND req.booking_intent->'tax_intent'->>'quote_id'=NEW.quote_id::text AND req.booking_intent->>'tax_calculation_id'=NEW.tax_calculation_id::text) THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_REQUEST' USING ERRCODE='23514';END IF;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM shipit.pricing_quotes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.quote_id AND actor_id=NEW.operator_id;
 SELECT * INTO t FROM shipit.tax_calculations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.tax_calculation_id AND actor_id=NEW.operator_id;
 IF r.id IS DISTINCT FROM NEW.account_revision_id OR r.state<>'active' OR q.id IS NULL OR t.id IS NULL OR q.result->'account'->>'revision_id' IS DISTINCT FROM r.id::text OR t.result->>'quote_id' IS DISTINCT FROM q.id::text
 OR NEW.amount_paise IS DISTINCT FROM (t.result->>'final_payable_paise')::bigint OR NEW.expires_at IS DISTINCT FROM LEAST(q.expires_at,(t.result->>'expires_at')::timestamptz)
 OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ACCOUNT_APPROVAL_SOURCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER customer_credit_approval_guard BEFORE INSERT ON shipit.customer_credit_approvals FOR EACH ROW EXECUTE FUNCTION shipit.guard_customer_credit_approval();
CREATE FUNCTION shipit.audit_customer_credit_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.customer_account_audit_events SELECT NEW.id,NEW.organization_id,NEW.franchise_id,NEW.account_id,'customer_accounts.approve',r.version,NEW.actor_id,NEW.correlation_id,NEW.recorded_at
 FROM shipit.customer_account_revisions r WHERE r.id=NEW.account_revision_id;RETURN NULL;
END $fn$;
CREATE TRIGGER customer_credit_approval_audit AFTER INSERT ON shipit.customer_credit_approvals FOR EACH ROW EXECUTE FUNCTION shipit.audit_customer_credit_approval();
CREATE FUNCTION shipit.customer_account_due_date(at_time timestamptz,closing_day integer,due_days integer) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE business_date date:=(at_time AT TIME ZONE 'Asia/Kolkata')::date;month_start date;closing date;
BEGIN
 month_start:=date_trunc('month',business_date)::date;
 closing:=LEAST(month_start+closing_day-1,(month_start+interval '1 month'-interval '1 day')::date);
 IF business_date>closing THEN month_start:=(month_start+interval '1 month')::date;closing:=LEAST(month_start+closing_day-1,(month_start+interval '1 month'-interval '1 day')::date);END IF;
 RETURN closing+due_days;
END $fn$;
CREATE FUNCTION shipit.guard_customer_account_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE b shipit.bookings;a shipit.customer_accounts;r shipit.customer_account_revisions;p shipit.customer_credit_approvals;outstanding numeric;overdue numeric;
BEGIN
 SELECT * INTO a FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 IF a.id IS NULL OR b.id IS NULL OR r.id IS DISTINCT FROM NEW.account_revision_id OR r.state<>'active' OR NOT(b.customer_id=ANY(r.shipping_customer_ids))
 OR NEW.debtor_customer_id IS DISTINCT FROM a.debtor_customer_id OR b.pricing_snapshot->'account'->>'revision_id' IS DISTINCT FROM r.id::text
 OR b.pricing_snapshot->'account'->>'rate_revision_id' IS DISTINCT FROM NEW.rate_revision_id::text
 OR NEW.snapshot->>'account_id' IS DISTINCT FROM a.id::text OR NEW.snapshot->>'account_revision_id' IS DISTINCT FROM r.id::text
 OR NEW.snapshot->'debtor'->>'source_customer_id' IS DISTINCT FROM a.debtor_customer_id::text OR NEW.snapshot->>'due_date' IS DISTINCT FROM NEW.due_date::text
 OR NEW.snapshot->>'approval_id' IS DISTINCT FROM NEW.approval_id::text OR NEW.snapshot->>'rate_revision_id' IS DISTINCT FROM NEW.rate_revision_id::text
 OR (NEW.snapshot->>'credit_limit_paise')::bigint IS DISTINCT FROM r.credit_limit_paise
 OR (NEW.snapshot->>'closing_day')::integer IS DISTINCT FROM r.closing_day OR (NEW.snapshot->>'due_days')::integer IS DISTINCT FROM r.due_days
 OR (NEW.snapshot->>'account_version')::integer IS DISTINCT FROM r.version
 OR NEW.snapshot->>'rate_source' IS DISTINCT FROM b.pricing_snapshot->'account'->>'rate_source'
 OR NEW.snapshot->'debtor' IS DISTINCT FROM (SELECT jsonb_build_object('source_customer_id',c.id,'source_customer_version',c.version,'name',c.name,'phone',c.phone_normalized,'phone_display',c.phone_display,'address',c.address) FROM shipit.customers c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.debtor_customer_id)
 OR NEW.due_date IS DISTINCT FROM shipit.customer_account_due_date(b.confirmed_at,r.closing_day,r.due_days) THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_SOURCE' USING ERRCODE='23514';END IF;
 SELECT COALESCE(sum(x.due),0),COALESCE(sum(x.due) FILTER(WHERE x.due_date<(b.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date),0) INTO outstanding,overdue
 FROM (SELECT ab.due_date,GREATEST(0,ob.total_paise::numeric-COALESCE(f.reduction,0)-COALESCE(e.collected,0)+COALESCE(f.refund,0)) due
 FROM shipit.customer_account_bookings ab JOIN shipit.booking_obligations ob ON ob.organization_id=ab.organization_id AND ob.franchise_id=ab.franchise_id AND ob.booking_id=ab.booking_id
 LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END) collected FROM shipit.payment_entries WHERE organization_id=ab.organization_id AND franchise_id=ab.franchise_id AND booking_id=ab.booking_id) e ON true
 LEFT JOIN LATERAL(SELECT sum(pre_tax::numeric+cgst+sgst+igst+rounding) reduction,sum(CASE WHEN kind='refund_correction' THEN -refund::numeric ELSE refund::numeric END) refund FROM shipit.financial_changes WHERE organization_id=ab.organization_id AND franchise_id=ab.franchise_id AND booking_id=ab.booking_id) f ON true
 WHERE ab.organization_id=NEW.organization_id AND ab.franchise_id=NEW.franchise_id AND ab.account_id=NEW.account_id) x;
 IF overdue>0 OR NEW.snapshot->>'exposure_before_paise' IS DISTINCT FROM outstanding::text THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_EXPOSURE' USING ERRCODE='23514';END IF;
 IF NEW.approval_id IS NOT NULL THEN
  SELECT * INTO p FROM shipit.customer_credit_approvals WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.approval_id FOR UPDATE;
  IF p.id IS NULL OR p.account_id<>a.id OR p.account_revision_id<>r.id OR p.amount_paise<>b.final_payable_paise OR p.expires_at<=b.confirmed_at OR p.quote_id<>b.pricing_quote_id OR p.tax_calculation_id<>b.tax_calculation_id
  OR NOT EXISTS(SELECT 1 FROM shipit.booking_commands c WHERE c.id=b.command_id AND c.principal_id=p.operator_id AND c.fingerprint=p.booking_fingerprint)
  OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=p.actor_id AND m.role='franchise_admin' AND m.lifecycle='active')
  THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_APPROVAL' USING ERRCODE='23514';END IF;
 ELSIF outstanding+b.final_payable_paise>r.credit_limit_paise THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_CREDIT' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER customer_account_booking_guard BEFORE INSERT ON shipit.customer_account_bookings FOR EACH ROW EXECUTE FUNCTION shipit.guard_customer_account_booking();
CREATE FUNCTION shipit.check_customer_account_booking_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF (NEW.pricing_snapshot ? 'account') IS DISTINCT FROM EXISTS(SELECT 1 FROM shipit.customer_account_bookings a WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.booking_id=NEW.id)
 THEN RAISE EXCEPTION 'ACCOUNT_BOOKING_INCOMPLETE' USING ERRCODE='23514';END IF;
 IF (SELECT c.result->'account' FROM shipit.booking_commands c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.command_id) IS DISTINCT FROM (SELECT a.snapshot FROM shipit.customer_account_bookings a WHERE a.organization_id=NEW.organization_id AND a.franchise_id=NEW.franchise_id AND a.booking_id=NEW.id) THEN RAISE EXCEPTION 'ACCOUNT_COMMAND_SNAPSHOT' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER customer_account_booking_complete AFTER INSERT ON shipit.bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_customer_account_booking_complete();
CREATE FUNCTION shipit.guard_customer_credit_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE q shipit.pricing_quotes;r shipit.customer_account_revisions;
BEGIN
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SCOPE' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND f.franchise_id=NEW.franchise_id AND m.user_id=NEW.operator_id AND m.role='operator' AND m.lifecycle='active') THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_ACTOR' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.customer_accounts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.account_id FOR UPDATE;
 SELECT * INTO r FROM shipit.customer_account_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND account_id=NEW.account_id ORDER BY version DESC LIMIT 1;
 SELECT * INTO q FROM shipit.pricing_quotes WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.booking_intent->'tax_intent'->>'quote_id')::uuid AND actor_id=NEW.operator_id;
 IF q.id IS NULL OR r.id IS NULL OR r.state<>'active' OR q.expires_at<=clock_timestamp()
 OR q.result->'account'->>'revision_id' IS DISTINCT FROM r.id::text
 OR NOT COALESCE((NEW.booking_intent->>'customer_id')::uuid=ANY(r.shipping_customer_ids),false)
 OR NEW.booking_intent ? 'credit_approval_id'
 OR NOT EXISTS(SELECT 1 FROM shipit.tax_calculations t JOIN shipit.tax_intents i ON i.organization_id=t.organization_id AND i.franchise_id=t.franchise_id AND i.id=t.intent_id WHERE t.organization_id=NEW.organization_id AND t.franchise_id=NEW.franchise_id AND t.id=(NEW.booking_intent->>'tax_calculation_id')::uuid AND t.actor_id=NEW.operator_id AND i.quote_id=q.id AND i.input=NEW.booking_intent->'tax_intent' AND (t.result->>'expires_at')::timestamptz>clock_timestamp())
 THEN RAISE EXCEPTION 'ACCOUNT_REQUEST_SOURCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();
 INSERT INTO shipit.customer_account_audit_events VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.account_id,'customer_accounts.request',r.version,NEW.operator_id,NEW.correlation_id,NEW.recorded_at);
 RETURN NEW;
END $fn$;
CREATE TRIGGER customer_credit_request_guard BEFORE INSERT ON shipit.customer_credit_requests FOR EACH ROW EXECUTE FUNCTION shipit.guard_customer_credit_request();
REVOKE ALL ON FUNCTION shipit.customer_account_due_date(timestamptz,integer,integer),shipit.check_customer_account_booking_complete(),shipit.guard_customer_credit_request() FROM PUBLIC;
-- Existing receipt allocation keeps its original shipping customer semantics for non-account bookings.
DO $allocation$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('shipit.guard_money_receipt_allocation()'::regprocedure) INTO definition;
 definition:=replace(definition,'SELECT customer_id INTO customer FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;',
 'SELECT COALESCE(a.debtor_customer_id,b.customer_id) INTO customer FROM shipit.bookings b LEFT JOIN shipit.customer_account_bookings a ON a.organization_id=b.organization_id AND a.franchise_id=b.franchise_id AND a.booking_id=b.id WHERE b.organization_id=NEW.organization_id AND b.franchise_id=NEW.franchise_id AND b.id=NEW.booking_id;');
 IF definition NOT LIKE '%COALESCE(a.debtor_customer_id,b.customer_id)%' THEN RAISE EXCEPTION 'RECEIPT_GUARD_UPGRADE_MISMATCH';END IF;
 EXECUTE definition;
END $allocation$;
REVOKE ALL ON shipit.customer_credit_requests,shipit.customer_credit_approvals,shipit.customer_account_bookings FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_customer_credit_approval(),shipit.audit_customer_credit_approval(),shipit.guard_customer_account_booking() FROM PUBLIC;
`);
exports.down=()=>{throw new Error('Forward-only migration: retain customer financial history');};
