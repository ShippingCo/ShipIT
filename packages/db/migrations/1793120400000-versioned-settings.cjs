// #66 empty installation means unconfigured. No profile/calendar/history backfill.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.settings_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES shipit.organizations(id),franchise_id uuid,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 effective_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 256),correlation_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='object' AND changes<>'{}'::jsonb AND octet_length(changes::text)<=65536),
 source_versions jsonb NOT NULL CHECK(jsonb_typeof(source_versions)='object'),
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,version),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE INDEX settings_versions_scope_time ON shipit.settings_versions(organization_id,franchise_id,effective_at DESC,version DESC);
CREATE TABLE shipit.settings_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES shipit.organizations(id),franchise_id uuid,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),
 fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),version_id uuid NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=131072),
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,actor_id,key_digest),UNIQUE(version_id),
 FOREIGN KEY(organization_id,version_id) REFERENCES shipit.settings_versions(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.settings_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid,version_id uuid NOT NULL UNIQUE,
 event_type text NOT NULL CHECK(event_type='settings.versioned'),actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 changed_keys text[] NOT NULL,recorded_at timestamptz NOT NULL,correlation_id uuid NOT NULL,
 FOREIGN KEY(organization_id,version_id) REFERENCES shipit.settings_versions(organization_id,id),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE FUNCTION shipit.guard_settings_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'SETTINGS_IMMUTABLE' USING ERRCODE='23514';END $fn$;
CREATE TRIGGER settings_versions_immutable BEFORE UPDATE OR DELETE ON shipit.settings_versions FOR EACH ROW EXECUTE FUNCTION shipit.guard_settings_immutable();
CREATE TRIGGER settings_commands_immutable BEFORE UPDATE OR DELETE ON shipit.settings_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_settings_immutable();
CREATE TRIGGER settings_events_immutable BEFORE UPDATE OR DELETE ON shipit.settings_events FOR EACH ROW EXECUTE FUNCTION shipit.guard_settings_immutable();
CREATE FUNCTION shipit.settings_value_valid(k text,v jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE allowed text[];required text[];item jsonb;n numeric;seen text[]:=ARRAY[]::text[];weekday text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 CASE k
 WHEN 'identity' THEN allowed:=ARRAY['display_name'];
 WHEN 'language' THEN allowed:=ARRAY['locale'];
 WHEN 'operating_hours' THEN allowed:=ARRAY['timezone','days'];
 WHEN 'booking_defaults' THEN allowed:=ARRAY['service'];
 WHEN 'collection_calendar' THEN allowed:=ARRAY['timezone','weekdays','holidays'];
 WHEN 'receiving_account' THEN allowed:=ARRAY['account_id','revision_id','method'];
 WHEN 'approval_policy' THEN allowed:=ARRAY['revision_id'];
 WHEN 'agent_fee_policy' THEN allowed:=ARRAY['agent_id','revision_id'];
 WHEN 'close_cutoff' THEN allowed:=ARRAY['timezone','minute'];
 WHEN 'credit_policy','overdue_policy','billing_terms' THEN RETURN v='{"state":"unconfigured","owner":"account_terms_v1"}'::jsonb;
 WHEN 'report_scope' THEN allowed:=ARRAY['franchise_ids'];
 WHEN 'reporting_schedule' THEN allowed:=ARRAY['report','franchise_ids','timezone','weekday','minute'];
 ELSE RETURN false;
 END CASE;
 IF v-allowed<>'{}'::jsonb OR NOT(v ?& allowed) THEN RETURN false;END IF;
 IF k='identity' THEN RETURN jsonb_typeof(v->'display_name')='string' AND length(v->>'display_name') BETWEEN 1 AND 120 AND btrim(v->>'display_name')<>'' AND (v->>'display_name')!~'[[:cntrl:]]';END IF;
 IF k='language' THEN RETURN v->>'locale' IN ('en','hi');END IF;
 IF k='booking_defaults' THEN RETURN v->>'service' IN ('standard','express','same_city');END IF;
 IF v ? 'timezone' THEN
  IF jsonb_typeof(v->'timezone')<>'string' OR length(v->>'timezone')>64 OR NOT(upper(v->>'timezone')='UTC' OR strpos(v->>'timezone','/')>0) OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE lower(name)=lower(v->>'timezone')) THEN RETURN false;END IF;
 END IF;
 IF k='collection_calendar' THEN
  IF v->>'timezone'<>'Asia/Kolkata' OR jsonb_typeof(v->'weekdays')<>'array' OR jsonb_typeof(v->'holidays')<>'array' THEN RETURN false;END IF;
  IF jsonb_array_length(v->'weekdays') NOT BETWEEN 1 AND 7 OR jsonb_array_length(v->'holidays')>366 THEN RETURN false;END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v->'weekdays') LOOP
   IF jsonb_typeof(item)<>'number' THEN RETURN false;END IF;n:=item::numeric;
   IF n<>trunc(n) OR n NOT BETWEEN 0 AND 6 OR n::text=ANY(seen) THEN RETURN false;END IF;seen:=array_append(seen,n::text);
  END LOOP;
  seen:=ARRAY[]::text[];
  FOR item IN SELECT * FROM jsonb_array_elements(v->'holidays') LOOP
   weekday:=item#>>'{}';
   IF jsonb_typeof(item)<>'string' OR weekday!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(weekday,4)='0000' OR to_char(weekday::date,'YYYY-MM-DD')<>weekday OR weekday=ANY(seen) THEN RETURN false;END IF;seen:=array_append(seen,weekday);
  END LOOP;
 END IF;
 IF k='operating_hours' THEN
  IF jsonb_typeof(v->'days')<>'array' OR jsonb_array_length(v->'days')>7 THEN RETURN false;END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v->'days') LOOP
   required:=ARRAY['weekday','opens_minute','closes_minute'];
   IF jsonb_typeof(item)<>'object' OR item-required<>'{}'::jsonb OR NOT(item ?& required) THEN RETURN false;END IF;
   FOREACH weekday IN ARRAY required LOOP
    IF jsonb_typeof(item->weekday)<>'number' OR (item->>weekday)::numeric<>trunc((item->>weekday)::numeric) THEN RETURN false;END IF;
   END LOOP;
   IF (item->>'weekday')::integer NOT BETWEEN 0 AND 6 OR (item->>'opens_minute')::integer NOT BETWEEN 0 AND 1439 OR (item->>'closes_minute')::integer NOT BETWEEN 1 AND 1440 OR (item->>'closes_minute')::integer<=(item->>'opens_minute')::integer OR item->>'weekday'=ANY(seen) THEN RETURN false;END IF;seen:=array_append(seen,item->>'weekday');
  END LOOP;
 END IF;
 FOREACH weekday IN ARRAY ARRAY['account_id','revision_id','agent_id'] LOOP
  IF v ? weekday AND (jsonb_typeof(v->weekday)<>'string' OR (v->>weekday)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN false;END IF;
 END LOOP;
 IF k='receiving_account' AND (jsonb_typeof(v->'method')<>'string' OR v->>'method' NOT IN ('cash','upi','bank_transfer','card','other')) THEN RETURN false;END IF;
 IF v ? 'franchise_ids' THEN
  IF jsonb_typeof(v->'franchise_ids')<>'array' OR jsonb_array_length(v->'franchise_ids') NOT BETWEEN 1 AND 50 THEN RETURN false;END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v->'franchise_ids') LOOP
   weekday:=item#>>'{}';IF jsonb_typeof(item)<>'string' OR weekday!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR weekday=ANY(seen) THEN RETURN false;END IF;seen:=array_append(seen,weekday);
  END LOOP;
 END IF;
 IF v ? 'minute' THEN
  IF jsonb_typeof(v->'minute')<>'number' THEN RETURN false;END IF;n:=(v->>'minute')::numeric;IF n<>trunc(n) OR n NOT BETWEEN 0 AND 1439 THEN RETURN false;END IF;
 END IF;
 IF k='reporting_schedule' THEN
  IF jsonb_typeof(v->'report')<>'string' OR v->>'report' NOT IN ('sales','contribution') OR jsonb_typeof(v->'weekday')<>'number' THEN RETURN false;END IF;n:=(v->>'weekday')::numeric;IF n<>trunc(n) OR n NOT BETWEEN 0 AND 6 THEN RETURN false;END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $fn$;
CREATE FUNCTION shipit.guard_settings_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE prior shipit.settings_versions;k text;v jsonb;allowed text[]:=ARRAY['identity','language','operating_hours','booking_defaults','collection_calendar','receiving_account','approval_policy','agent_fee_policy','close_cutoff','credit_policy','overdue_policy','billing_terms','report_scope','reporting_schedule'];p jsonb;s jsonb;
BEGIN
 IF NEW.effective_at IS NOT NULL OR NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SETTINGS_GENERATED_TIME' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_SCOPE' USING ERRCODE='42501';END IF;
 IF NEW.franchise_id IS NOT NULL THEN
  PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTINGS_SCOPE' USING ERRCODE='42501';END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND
  (NEW.franchise_id IS NULL AND m.role='org_admin' OR NEW.franchise_id IS NOT NULL AND m.role='franchise_admin' AND EXISTS(SELECT 1 FROM shipit.membership_franchise_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=NEW.franchise_id))) THEN RAISE EXCEPTION 'SETTINGS_ACTOR' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM shipit.settings_versions WHERE organization_id=NEW.organization_id AND franchise_id IS NOT DISTINCT FROM NEW.franchise_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(prior.version,0)+1 THEN RAISE EXCEPTION 'SETTINGS_VERSION' USING ERRCODE='40001';END IF;
 p:=COALESCE(prior.payload,'{}'::jsonb);s:=COALESCE(prior.source_versions,'{}'::jsonb);
 FOR k,v IN SELECT * FROM jsonb_each(NEW.changes) LOOP
  IF NOT(k=ANY(allowed)) OR NEW.franchise_id IS NULL AND k=ANY(ARRAY['receiving_account','approval_policy','agent_fee_policy']) THEN RAISE EXCEPTION 'SETTINGS_KEY' USING ERRCODE='23514';END IF;
  IF v='null'::jsonb THEN p:=p-k;s:=s-k;
  ELSE
   IF shipit.settings_value_valid(k,v) IS DISTINCT FROM true THEN RAISE EXCEPTION 'SETTINGS_VALUE' USING ERRCODE='23514';END IF;
   IF (k='identity' AND (v-ARRAY['display_name']<>'{}'::jsonb OR jsonb_typeof(v->'display_name') IS DISTINCT FROM 'string')) OR
    (k='language' AND (v-ARRAY['locale']<>'{}'::jsonb OR COALESCE(v->>'locale','') NOT IN ('en','hi'))) OR
    (k='booking_defaults' AND (v-ARRAY['service']<>'{}'::jsonb OR COALESCE(v->>'service','') NOT IN ('standard','express','same_city'))) OR
    (k=ANY(ARRAY['credit_policy','overdue_policy','billing_terms']) AND v<>'{"state":"unconfigured","owner":"account_terms_v1"}'::jsonb) OR
    (k='collection_calendar' AND (v-ARRAY['timezone','weekdays','holidays']<>'{}'::jsonb OR COALESCE(v->>'timezone','')<>'Asia/Kolkata' OR jsonb_typeof(v->'weekdays') IS DISTINCT FROM 'array' OR jsonb_typeof(v->'holidays') IS DISTINCT FROM 'array')) OR
    (k='receiving_account' AND v-ARRAY['account_id','revision_id','method']<>'{}'::jsonb) OR
    (k='approval_policy' AND v-ARRAY['revision_id']<>'{}'::jsonb) OR
    (k='agent_fee_policy' AND v-ARRAY['agent_id','revision_id']<>'{}'::jsonb) OR
    (k='operating_hours' AND v-ARRAY['timezone','days']<>'{}'::jsonb) OR
    (k='close_cutoff' AND v-ARRAY['timezone','minute']<>'{}'::jsonb) OR
    (k='report_scope' AND v-ARRAY['franchise_ids']<>'{}'::jsonb) OR
    (k='reporting_schedule' AND v-ARRAY['report','franchise_ids','timezone','weekday','minute']<>'{}'::jsonb)
    THEN RAISE EXCEPTION 'SETTINGS_VALUE' USING ERRCODE='23514';END IF;
   IF k='receiving_account' AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.account_id=(v->>'account_id')::uuid AND r.id=(v->>'revision_id')::uuid AND r.active AND v->>'method'=ANY(r.methods) AND NOT EXISTS(SELECT 1 FROM shipit.receiving_account_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.account_id=r.account_id AND n.version>r.version)) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k='approval_policy' AND NOT EXISTS(SELECT 1 FROM shipit.financial_policy_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(v->>'revision_id')::uuid AND r.enabled AND NOT r.allow_self_approval AND r.discount_review_threshold_paise IS NULL AND NOT EXISTS(SELECT 1 FROM shipit.financial_policy_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.version>r.version)) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k='agent_fee_policy' AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(v->>'revision_id')::uuid AND r.agent_id=(v->>'agent_id')::uuid AND r.active AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.agent_id=r.agent_id AND n.version>r.version) AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=r.organization_id AND f.franchise_id=r.franchise_id AND m.user_id=r.agent_id AND m.role='delivery_agent' AND m.lifecycle='active')) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k IN ('report_scope','reporting_schedule') THEN
    IF NEW.franchise_id IS NOT NULL AND NOT(v->'franchise_ids' ? NEW.franchise_id::text) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v->'franchise_ids') i WHERE NOT EXISTS(SELECT 1 FROM shipit.franchises f WHERE f.organization_id=NEW.organization_id AND f.id=i::uuid) OR NOT EXISTS(SELECT 1 FROM shipit.memberships m WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='org_admin' OR m.role IN ('franchise_admin','accountant') AND EXISTS(SELECT 1 FROM shipit.membership_franchise_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=i::uuid)))) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   END IF;
   p:=p||jsonb_build_object(k,v);s:=s||jsonb_build_object(k,NEW.version);
  END IF;
 END LOOP;
 IF NEW.payload<>p OR NEW.source_versions<>s THEN RAISE EXCEPTION 'SETTINGS_PROVENANCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();NEW.effective_at:=NEW.recorded_at;
 IF prior.effective_at IS NOT NULL AND NEW.effective_at<=prior.effective_at THEN RAISE EXCEPTION 'SETTINGS_TIME' USING ERRCODE='40001';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER settings_version_guard BEFORE INSERT ON shipit.settings_versions FOR EACH ROW EXECUTE FUNCTION shipit.guard_settings_version();
CREATE FUNCTION shipit.complete_settings_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.settings_events(id,organization_id,franchise_id,version_id,event_type,actor_id,changed_keys,recorded_at,correlation_id)
 VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.id,'settings.versioned',NEW.actor_id,ARRAY(SELECT jsonb_object_keys(NEW.changes) ORDER BY 1),NEW.recorded_at,NEW.correlation_id);
 RETURN NEW;
END $fn$;
CREATE TRIGGER settings_version_complete AFTER INSERT ON shipit.settings_versions FOR EACH ROW EXECUTE FUNCTION shipit.complete_settings_version();
CREATE FUNCTION shipit.check_settings_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM shipit.settings_commands c WHERE c.organization_id=NEW.organization_id AND c.franchise_id IS NOT DISTINCT FROM NEW.franchise_id AND c.actor_id=NEW.actor_id AND c.version_id=NEW.id AND c.result->>'version_id'=NEW.id::text) THEN RAISE EXCEPTION 'SETTINGS_RECEIPT_REQUIRED' USING ERRCODE='23514';END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER settings_receipt_required AFTER INSERT ON shipit.settings_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_settings_receipt();
REVOKE ALL ON shipit.settings_versions,shipit.settings_commands,shipit.settings_events FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.settings_value_valid(text,jsonb),shipit.guard_settings_immutable(),shipit.guard_settings_version(),shipit.complete_settings_version(),shipit.check_settings_receipt() FROM PUBLIC;
DO $audit$ DECLARE source text;BEGIN SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$ UNION ALL SELECT 'settings:'||id::text,organization_id,CASE WHEN franchise_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[franchise_id] END,'user',actor_id::text,'settings.versioned','settings_version',id,'success','future_configuration',correlation_id,recorded_at,NULL,NULL,version,NULL FROM shipit.settings_versions$view$;END $audit$;
`);
exports.down=()=>{throw new Error('SETTINGS_FORWARD_ONLY');};
