// Shop display and bounded raster branding use the existing version, audit and exact replay contracts.
exports.up=pgm=>pgm.sql(String.raw`
CREATE FUNCTION shipit.settings_shop_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE k text;lim integer;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['tagline','origin_city','support_phone','address','assistant_name','logo']<>'{}'::jsonb OR NOT(v ?& ARRAY['tagline','origin_city','support_phone','address','assistant_name','logo']) THEN RETURN false;END IF;
 FOR k,lim IN SELECT * FROM (VALUES ('tagline',160),('origin_city',120),('support_phone',40),('address',500),('assistant_name',120)) limits LOOP
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR length(v->>k)>lim OR (v->>k)~'[[:cntrl:]]' THEN RETURN false;END IF;
 END LOOP;
 IF v->>'support_phone'<>'' AND (v->>'support_phone')!~'^\+?[0-9 ()-]{7,40}$' THEN RETURN false;END IF;
 RETURN v->'logo'='null'::jsonb OR jsonb_typeof(v->'logo')='string' AND length(v->>'logo')<=30000 AND (v->>'logo')~'^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$';
END $fn$;
CREATE OR REPLACE FUNCTION shipit.settings_value_valid(k text,v jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE allowed text[];required text[];item jsonb;n numeric;seen text[]:=ARRAY[]::text[];weekday text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 CASE k
 WHEN 'identity' THEN RETURN v-ARRAY['display_name','shop']='{}'::jsonb AND jsonb_typeof(v->'display_name')='string' AND length(v->>'display_name') BETWEEN 1 AND 120 AND btrim(v->>'display_name')<>'' AND (v->>'display_name')!~'[[:cntrl:]]' AND (NOT(v?'shop') OR shipit.settings_shop_valid(v->'shop'));
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
CREATE OR REPLACE FUNCTION shipit.guard_settings_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
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
  (NEW.franchise_id IS NULL AND m.role='org_admin' OR NEW.franchise_id IS NOT NULL AND m.role IN ('org_admin','franchise_admin') AND EXISTS(SELECT 1 FROM shipit.business_membership_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=NEW.franchise_id))) THEN RAISE EXCEPTION 'SETTINGS_ACTOR' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM shipit.settings_versions WHERE organization_id=NEW.organization_id AND franchise_id IS NOT DISTINCT FROM NEW.franchise_id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>COALESCE(prior.version,0)+1 THEN RAISE EXCEPTION 'SETTINGS_VERSION' USING ERRCODE='40001';END IF;
 p:=COALESCE(prior.payload,'{}'::jsonb);s:=COALESCE(prior.source_versions,'{}'::jsonb);
 FOR k,v IN SELECT * FROM jsonb_each(NEW.changes) LOOP
  IF NOT(k=ANY(allowed)) OR NEW.franchise_id IS NULL AND k=ANY(ARRAY['receiving_account','approval_policy','agent_fee_policy']) THEN RAISE EXCEPTION 'SETTINGS_KEY' USING ERRCODE='23514';END IF;
  IF v='null'::jsonb THEN p:=p-k;s:=s-k;
  ELSE
   IF shipit.settings_value_valid(k,v) IS DISTINCT FROM true THEN RAISE EXCEPTION 'SETTINGS_VALUE' USING ERRCODE='23514';END IF;
   IF (k='identity' AND (v-ARRAY['display_name','shop']<>'{}'::jsonb OR jsonb_typeof(v->'display_name') IS DISTINCT FROM 'string')) OR
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
   IF k='agent_fee_policy' AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions r WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(v->>'revision_id')::uuid AND r.agent_id=(v->>'agent_id')::uuid AND r.active AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM shipit.agent_fee_term_revisions n WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.agent_id=r.agent_id AND n.version>r.version) AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE m.organization_id=r.organization_id AND f.franchise_id=r.franchise_id AND m.user_id=r.agent_id AND m.role='delivery_agent' AND m.lifecycle='active')) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   IF k IN ('report_scope','reporting_schedule') THEN
    IF NEW.franchise_id IS NOT NULL AND NOT(v->'franchise_ids' ? NEW.franchise_id::text) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v->'franchise_ids') i WHERE NOT EXISTS(SELECT 1 FROM shipit.franchises f WHERE f.organization_id=NEW.organization_id AND f.id=i::uuid) OR NOT EXISTS(SELECT 1 FROM shipit.memberships m WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.actor_id AND m.lifecycle='active' AND (m.role='org_admin' OR m.role IN ('franchise_admin','accountant','org_admin') AND EXISTS(SELECT 1 FROM shipit.business_membership_scopes f WHERE f.organization_id=m.organization_id AND f.membership_id=m.id AND f.franchise_id=i::uuid)))) THEN RAISE EXCEPTION 'SETTINGS_REFERENCE' USING ERRCODE='42501';END IF;
   END IF;
   p:=p||jsonb_build_object(k,v);s:=s||jsonb_build_object(k,NEW.version);
  END IF;
 END LOOP;
 IF NEW.payload<>p OR NEW.source_versions<>s THEN RAISE EXCEPTION 'SETTINGS_PROVENANCE' USING ERRCODE='23514';END IF;
 NEW.recorded_at:=clock_timestamp();NEW.effective_at:=NEW.recorded_at;
 IF prior.effective_at IS NOT NULL AND NEW.effective_at<=prior.effective_at THEN RAISE EXCEPTION 'SETTINGS_TIME' USING ERRCODE='40001';END IF;
 RETURN NEW;
END $fn$;
`);
exports.down=()=>{throw new Error("Shop presentation versions are append-only; use a forward migration.");};
