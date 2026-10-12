// #147 Cost evidence is not a cash ledger. No historical cost or zero backfill.
exports.up=pgm=>pgm.sql(String.raw`
CREATE TABLE shipit.shipment_cost_sources (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,category text NOT NULL CHECK(category IN ('courier','packing','agent','payment')),
 UNIQUE(organization_id,franchise_id,id),FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.shipment_cost_commands (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 operation text NOT NULL CHECK(operation IN ('record','preview','apply','read','list','selectors')),key_digest text NOT NULL CHECK(key_digest~'^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(octet_length(result::text)<=8388608),correlation_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,actor_id,operation,key_digest),
 FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id)
);
CREATE TABLE shipit.shipment_cost_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,source_id uuid NOT NULL,command_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 2147483646),state text NOT NULL CHECK(state IN ('actual','estimated','not_applicable')),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),recorded_at timestamptz NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 256),reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 128),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=16384),
 allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array' AND jsonb_array_length(allocations) BETWEEN 1 AND 100),
 input_fingerprint text NOT NULL CHECK(input_fingerprint~'^[a-f0-9]{64}$'),
 UNIQUE(organization_id,franchise_id,id),UNIQUE(organization_id,franchise_id,source_id,version),
 FOREIGN KEY(organization_id,franchise_id,source_id) REFERENCES shipit.shipment_cost_sources(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,command_id) REFERENCES shipit.shipment_cost_commands(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='not_applicable' AND amount_paise=0) OR (state<>'not_applicable' AND (amount_paise>0 OR state='actual' AND evidence->>'kind'='applied_expense')))
);
CREATE INDEX shipment_cost_revision_cutoff ON shipit.shipment_cost_revisions(organization_id,franchise_id,source_id,version DESC,effective_at,recorded_at);
CREATE TABLE shipit.shipment_cost_allocations (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,revision_id uuid NOT NULL,booking_id uuid NOT NULL,parcel_id uuid,amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),
 UNIQUE NULLS NOT DISTINCT(organization_id,franchise_id,revision_id,booking_id,parcel_id),
 FOREIGN KEY(organization_id,franchise_id,revision_id) REFERENCES shipit.shipment_cost_revisions(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id)
);
CREATE INDEX shipment_cost_allocation_booking ON shipit.shipment_cost_allocations(organization_id,franchise_id,booking_id,revision_id);
CREATE TABLE shipit.shipment_cost_aliases (
 organization_id uuid NOT NULL,franchise_id uuid NOT NULL,source_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('invoice','expense','rate')),identity text NOT NULL CHECK(length(identity) BETWEEN 1 AND 512),
 PRIMARY KEY(organization_id,franchise_id,kind,identity),FOREIGN KEY(organization_id,franchise_id,source_id) REFERENCES shipit.shipment_cost_sources(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.guard_shipment_cost_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SHIPMENT_COST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME IN ('shipment_cost_aliases','shipment_cost_allocations') AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'SHIPMENT_COST_GENERATED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER shipment_cost_source_guard BEFORE UPDATE OR DELETE ON shipit.shipment_cost_sources FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_immutable();
CREATE TRIGGER shipment_cost_command_guard BEFORE UPDATE OR DELETE ON shipit.shipment_cost_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_immutable();
CREATE TRIGGER shipment_cost_alias_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.shipment_cost_aliases FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_immutable();
CREATE TRIGGER shipment_cost_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.shipment_cost_allocations FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_immutable();
CREATE FUNCTION shipit.guard_shipment_cost_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE previous shipit.shipment_cost_revisions;source shipit.shipment_cost_sources;a jsonb;total numeric:=0;kind text;identity text;existing uuid;expense shipit.cashbook_requests;root uuid;fee shipit.agent_fee_earnings;rate shipit.carrier_rate_imports;approval shipit.carrier_rate_approvals;booking shipit.bookings;rate_row jsonb;rate_inputs jsonb;rate_amount bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SHIPMENT_COST_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_GENERATED' USING ERRCODE='23514';END IF;
 PERFORM id FROM shipit.organizations WHERE id=NEW.organization_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_COST_SCOPE' USING ERRCODE='42501';END IF;
 PERFORM id FROM shipit.franchises WHERE organization_id=NEW.organization_id AND id=NEW.franchise_id AND lifecycle='active' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role='franchise_admin' AND m.lifecycle='active') THEN RAISE EXCEPTION 'SHIPMENT_COST_ACTOR' USING ERRCODE='42501';END IF;
 SELECT * INTO source FROM shipit.shipment_cost_sources WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.source_id FOR UPDATE;
 SELECT * INTO previous FROM shipit.shipment_cost_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND source_id=NEW.source_id ORDER BY version DESC LIMIT 1;
 IF source.id IS NULL OR NEW.version<>COALESCE(previous.version,0)+1 THEN RAISE EXCEPTION 'SHIPMENT_COST_VERSION' USING ERRCODE='40001';END IF;
 NEW.recorded_at:=clock_timestamp();
 IF NEW.effective_at>NEW.recorded_at THEN RAISE EXCEPTION 'SHIPMENT_COST_EFFECTIVE' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'independently_verified' IS DISTINCT FROM 'false' OR NEW.evidence->>'kind' NOT IN ('manual','carrier_rate','applied_expense','declaration') THEN RAISE EXCEPTION 'SHIPMENT_COST_EVIDENCE' USING ERRCODE='23514';END IF;
 IF (NEW.evidence->>'kind'='declaration') IS DISTINCT FROM (NEW.state='not_applicable') OR (NEW.evidence->>'kind'='applied_expense') IS DISTINCT FROM (NEW.evidence->>'expense_head_id' IS NOT NULL AND NEW.evidence->>'expense_root_id' IS NOT NULL) OR (NEW.evidence->>'kind'='carrier_rate') IS DISTINCT FROM (NEW.evidence->>'rate_import_id' IS NOT NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_EVIDENCE' USING ERRCODE='23514';END IF;
 IF (NEW.evidence->>'supplier' IS NULL) IS DISTINCT FROM (NEW.evidence->>'document' IS NULL) OR (NEW.evidence->>'supplier' IS NULL) IS DISTINCT FROM (NEW.evidence->>'line' IS NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_INVOICE' USING ERRCODE='23514';END IF;
 FOR identity IN SELECT NEW.evidence->>'supplier' UNION ALL SELECT NEW.evidence->>'document' UNION ALL SELECT NEW.evidence->>'line' LOOP
  IF identity IS NOT NULL AND (length(identity) NOT BETWEEN 1 AND 128 OR identity IS DISTINCT FROM upper(pg_catalog.normalize(btrim(identity),'NFKC')) OR identity~'[[:cntrl:]]') THEN RAISE EXCEPTION 'SHIPMENT_COST_INVOICE' USING ERRCODE='23514';END IF;
 END LOOP;
 IF NEW.state='not_applicable' AND (NEW.evidence->>'kind'<>'declaration' OR previous.amount_paise>0) THEN RAISE EXCEPTION 'SHIPMENT_COST_DECLARATION' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'expense_head_id' IS NOT NULL THEN
  SELECT r.* INTO expense FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.id=(NEW.evidence->>'expense_head_id')::uuid AND r.kind='expense';
  IF expense.id IS NULL OR EXISTS(SELECT 1 FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id WHERE r.organization_id=NEW.organization_id AND r.franchise_id=NEW.franchise_id AND r.correction_of=expense.id) OR NEW.amount_paise<>expense.amount_paise OR NEW.state<>'actual' OR NEW.effective_at<>expense.occurred_at THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE' USING ERRCODE='23514';END IF;
  root:=expense.id;
  WHILE expense.correction_of IS NOT NULL LOOP SELECT * INTO expense FROM shipit.cashbook_requests WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=expense.correction_of;root:=expense.id;END LOOP;
  IF root::text IS DISTINCT FROM NEW.evidence->>'expense_root_id' THEN RAISE EXCEPTION 'SHIPMENT_COST_ROOT' USING ERRCODE='23514';END IF;
  IF expense.fee_earning_id IS NOT NULL THEN SELECT * INTO fee FROM shipit.agent_fee_earnings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=expense.fee_earning_id;IF fee.basis='per_delivery' OR source.category<>'agent' THEN RAISE EXCEPTION 'SHIPMENT_COST_AGENT' USING ERRCODE='23514';END IF;END IF;
 END IF;
 IF NEW.evidence->>'kind'='manual' AND (COALESCE(NEW.evidence->>'supplier','')='' OR COALESCE(NEW.evidence->>'document','')='' OR COALESCE(NEW.evidence->>'line','')='' OR NEW.evidence->>'expense_root_id' IS NOT NULL OR NEW.evidence->>'rate_import_id' IS NOT NULL) THEN RAISE EXCEPTION 'SHIPMENT_COST_MANUAL' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'kind'='applied_expense' AND NEW.evidence->>'expense_head_id' IS NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE' USING ERRCODE='23514';END IF;
 IF NEW.evidence->>'kind'='carrier_rate' THEN
  SELECT * INTO rate FROM shipit.carrier_rate_imports WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.evidence->>'rate_import_id')::uuid AND purpose='courier_purchase_estimate';
  SELECT * INTO approval FROM shipit.carrier_rate_approvals WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND import_id=rate.id;
  SELECT * INTO booking FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=(NEW.evidence->>'rate_booking_id')::uuid;
  IF rate.id IS NULL OR approval.id IS NULL OR booking.id IS NULL OR source.category<>'courier' OR NEW.state<>'estimated' OR approval.id::text IS DISTINCT FROM NEW.evidence->>'rate_approval_id' OR rate.normalization_version IS DISTINCT FROM NEW.evidence->>'rate_version' OR booking.confirmed_at<(rate.config->'policy'->>'effective_from')::timestamptz OR booking.confirmed_at>=(rate.config->'policy'->>'effective_to')::timestamptz THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE' USING ERRCODE='23514';END IF;
  rate_inputs:=jsonb_build_object('service',booking.pricing_snapshot->'inputs'->>'service','destination_key',booking.pricing_snapshot->'inputs'->>'destination_key','weight_grams',booking.pricing_snapshot->'inputs'->'weight_grams');
  SELECT value INTO rate_row FROM jsonb_array_elements(rate.rows) WHERE (value->>'row')::integer=(NEW.evidence->>'rate_row')::integer;
  IF rate_row IS NULL OR rate_row->>'error' IS NOT NULL OR rate_row->'rule'->>'service' IS DISTINCT FROM rate_inputs->>'service' OR rate_row->'rule'->>'destination_key' IS DISTINCT FROM rate_inputs->>'destination_key' OR (rate_inputs->>'weight_grams')::bigint<(rate_row->'rule'->>'min_weight_grams')::bigint OR (rate_inputs->>'weight_grams')::bigint>=(rate_row->'rule'->>'max_weight_grams')::bigint OR NEW.evidence->'rate_inputs' IS DISTINCT FROM rate_inputs OR NEW.evidence->'rate_mapping_ids' IS DISTINCT FROM rate_row->'mapping_ids' THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE_INPUTS' USING ERRCODE='23514';END IF;
  rate_amount:=(rate_row->'rule'->>'freight_paise')::bigint+(rate_row->'rule'->>'packing_paise')::bigint;
  IF NEW.amount_paise<>rate_amount OR NEW.allocations<>jsonb_build_array(jsonb_build_object('booking_id',booking.id,'parcel_id',NULL,'amount_paise',rate_amount)) THEN RAISE EXCEPTION 'SHIPMENT_COST_RATE_AMOUNT' USING ERRCODE='23514';END IF;
 END IF;
 IF previous.evidence->>'expense_root_id' IS NOT NULL AND previous.evidence->>'expense_root_id' IS DISTINCT FROM NEW.evidence->>'expense_root_id' THEN RAISE EXCEPTION 'SHIPMENT_COST_EXPENSE_UNLINK' USING ERRCODE='23514';END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(NEW.allocations) LOOP
  IF jsonb_typeof(a)<>'object' OR a-ARRAY['booking_id','parcel_id','amount_paise']<>'{}'::jsonb OR COALESCE(a->>'amount_paise','')!~'^(0|[1-9][0-9]{0,15})$' OR (a->>'amount_paise')::numeric>9007199254740991 OR (NEW.amount_paise=0) IS DISTINCT FROM ((a->>'amount_paise')::numeric=0) THEN RAISE EXCEPTION 'SHIPMENT_COST_ALLOCATION' USING ERRCODE='23514';END IF;
  total:=total+(a->>'amount_paise')::numeric;
 END LOOP;
 IF total>NEW.amount_paise THEN RAISE EXCEPTION 'SHIPMENT_COST_CAPACITY' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER shipment_cost_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON shipit.shipment_cost_revisions FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_revision();
CREATE FUNCTION shipit.complete_shipment_cost_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE a jsonb;k text;i text;existing uuid;
BEGIN
 INSERT INTO shipit.shipment_cost_allocations SELECT NEW.organization_id,NEW.franchise_id,NEW.id,(v->>'booking_id')::uuid,(v->>'parcel_id')::uuid,(v->>'amount_paise')::bigint FROM jsonb_array_elements(NEW.allocations) v;
 FOR k,i IN SELECT 'invoice',jsonb_build_array(NEW.evidence->>'supplier',NEW.evidence->>'document',NEW.evidence->>'line')::text WHERE NEW.evidence->>'supplier' IS NOT NULL UNION ALL SELECT 'expense',NEW.evidence->>'expense_root_id' WHERE NEW.evidence->>'expense_root_id' IS NOT NULL UNION ALL SELECT 'rate',(NEW.evidence->>'rate_import_id')||':'||(NEW.evidence->>'rate_booking_id') WHERE NEW.evidence->>'rate_import_id' IS NOT NULL LOOP
  SELECT source_id INTO existing FROM shipit.shipment_cost_aliases WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND kind=k AND identity=i;
  IF existing IS NOT NULL AND existing<>NEW.source_id THEN RAISE EXCEPTION 'SHIPMENT_COST_DUPLICATE' USING ERRCODE='23505';END IF;
  IF existing IS NULL THEN INSERT INTO shipit.shipment_cost_aliases VALUES(NEW.organization_id,NEW.franchise_id,NEW.source_id,k,i);END IF;
 END LOOP;
 RETURN NEW;
END $fn$;
CREATE TRIGGER shipment_cost_revision_complete AFTER INSERT ON shipit.shipment_cost_revisions FOR EACH ROW EXECUTE FUNCTION shipit.complete_shipment_cost_revision();
CREATE FUNCTION shipit.guard_shipment_cost_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.recorded_at IS NOT NULL THEN RAISE EXCEPTION 'SHIPMENT_COST_GENERATED' USING ERRCODE='23514';END IF;
 IF NEW.operation IN ('record','preview','apply') AND NOT EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id WHERE s.organization_id=NEW.organization_id AND s.franchise_id=NEW.franchise_id AND m.user_id=NEW.actor_id AND m.role='franchise_admin' AND m.lifecycle='active') THEN RAISE EXCEPTION 'SHIPMENT_COST_ACTOR' USING ERRCODE='42501';END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $fn$;
CREATE TRIGGER shipment_cost_command_insert BEFORE INSERT ON shipit.shipment_cost_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_shipment_cost_command();
CREATE FUNCTION shipit.check_shipment_cost_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF TG_TABLE_NAME='shipment_cost_sources' THEN
  IF NOT EXISTS(SELECT 1 FROM shipit.shipment_cost_revisions WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND source_id=NEW.id) THEN RAISE EXCEPTION 'SHIPMENT_COST_INCOMPLETE' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM shipit.shipment_cost_commands c WHERE c.organization_id=NEW.organization_id AND c.franchise_id=NEW.franchise_id AND c.id=NEW.command_id AND c.actor_id=NEW.actor_id AND c.operation IN ('record','apply') AND (c.operation='record' AND c.result->>'id'=NEW.id::text OR c.operation='apply' AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.result->'items') i WHERE i->>'id'=NEW.id::text))) THEN RAISE EXCEPTION 'SHIPMENT_COST_COMMAND_INCOMPLETE' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $fn$;
CREATE CONSTRAINT TRIGGER shipment_cost_source_complete AFTER INSERT ON shipit.shipment_cost_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_shipment_cost_complete();
CREATE CONSTRAINT TRIGGER shipment_cost_command_complete AFTER INSERT ON shipit.shipment_cost_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION shipit.check_shipment_cost_complete();
REVOKE ALL ON shipit.shipment_cost_sources,shipit.shipment_cost_revisions,shipit.shipment_cost_allocations,shipit.shipment_cost_aliases,shipit.shipment_cost_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.guard_shipment_cost_immutable(),shipit.guard_shipment_cost_revision(),shipit.complete_shipment_cost_revision(),shipit.guard_shipment_cost_command(),shipit.check_shipment_cost_complete() FROM PUBLIC;
DO $audit$ DECLARE source text;BEGIN SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$ UNION ALL SELECT 'shipment-cost:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'shipment_cost.'||operation,'shipment_cost_command',id,'success','shipment_cost_'||operation,correlation_id,recorded_at,NULL,NULL,NULL,NULL FROM shipit.shipment_cost_commands$view$;END $audit$;
`);
exports.down=()=>{throw new Error('SHIPMENT_COST_FORWARD_ONLY');};
