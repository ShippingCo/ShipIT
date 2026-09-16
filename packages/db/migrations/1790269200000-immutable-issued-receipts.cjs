// Forward-only #30. No historical issuance/backfill; all source facts remain untouched.
exports.up = pgm => {
  pgm.sql(String.raw`
CREATE SEQUENCE shipit.issued_receipt_numbers AS bigint NO CYCLE;
CREATE TABLE shipit.issued_receipts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,
 obligation_id uuid NOT NULL,payment_entry_id uuid,kind text NOT NULL CHECK(kind IN ('booking_charge','collection_acknowledgement','collection_reversal')),
 number text NOT NULL UNIQUE CHECK(number ~ '^RCT-[0-9]{19}$'),schema_version integer NOT NULL CHECK(schema_version=1),
 version integer NOT NULL CHECK(version>0),booking_receipt_id uuid,correction_of uuid,
 issued_at timestamptz NOT NULL CHECK(isfinite(issued_at)),snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,correlation_id uuid NOT NULL,
 UNIQUE(organization_id,franchise_id,booking_id,id),UNIQUE(organization_id,franchise_id,number),
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id) REFERENCES shipit.booking_obligations(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,obligation_id,payment_entry_id) REFERENCES shipit.payment_entries(organization_id,franchise_id,booking_id,obligation_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,booking_receipt_id) REFERENCES shipit.issued_receipts(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,franchise_id,booking_id,correction_of) REFERENCES shipit.issued_receipts(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
 CHECK((kind='booking_charge' AND payment_entry_id IS NULL AND booking_receipt_id IS NULL AND correction_of IS NULL AND version=1)
  OR (kind='collection_acknowledgement' AND payment_entry_id IS NOT NULL AND booking_receipt_id IS NOT NULL AND correction_of IS NULL)
  OR (kind='collection_reversal' AND payment_entry_id IS NOT NULL AND booking_receipt_id IS NOT NULL AND correction_of IS NOT NULL)),
 CHECK((jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=65536 AND snapshot->>'currency'='INR') IS TRUE)
);
CREATE UNIQUE INDEX issued_receipts_booking_idx ON shipit.issued_receipts(organization_id,franchise_id,booking_id) WHERE kind='booking_charge';
CREATE UNIQUE INDEX issued_receipts_payment_idx ON shipit.issued_receipts(organization_id,franchise_id,payment_entry_id) WHERE payment_entry_id IS NOT NULL;
CREATE INDEX issued_receipts_owner_id_idx ON shipit.issued_receipts(organization_id,franchise_id,id);
CREATE INDEX issued_receipts_correction_idx ON shipit.issued_receipts(organization_id,franchise_id,correction_of);
CREATE TABLE shipit.receipt_audit_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,booking_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,correlation_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),version integer NOT NULL CHECK(version>0),
 FOREIGN KEY(organization_id,franchise_id,booking_id,id) REFERENCES shipit.issued_receipts(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT
);
CREATE INDEX receipt_audit_owner_idx ON shipit.receipt_audit_events(organization_id,franchise_id,id);
CREATE TRIGGER receipt_audit_immutable BEFORE UPDATE OR DELETE ON shipit.receipt_audit_events FOR EACH ROW EXECUTE FUNCTION shipit.reject_parcel_history_mutation();

-- Only this trigger owns generated document contents. Runtime INSERT grants exclude them.
CREATE FUNCTION shipit.issue_receipt_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE b record;o record;e record;base record;original record;
 issuer jsonb;shipment jsonb;tax jsonb;parts jsonb;payment jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'RECEIPT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.number IS NOT NULL OR NEW.schema_version IS NOT NULL OR NEW.version IS NOT NULL OR NEW.issued_at IS NOT NULL OR NEW.snapshot IS NOT NULL
 THEN RAISE EXCEPTION 'RECEIPT_GENERATED_FIELDS' USING ERRCODE='23514'; END IF;
 SELECT id,total_paise INTO o FROM shipit.booking_obligations WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id FOR UPDATE;
 SELECT id,tax_snapshot,customer_snapshot,pricing_snapshot,confirmed_at,parcel_count,final_payable_paise INTO b FROM shipit.bookings WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND id=NEW.booking_id;
 IF o.id IS NULL OR b.id IS NULL OR NEW.obligation_id IS DISTINCT FROM o.id THEN RAISE EXCEPTION 'RECEIPT_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 NEW.number='RCT-'||lpad(nextval('shipit.issued_receipt_numbers')::text,19,'0');
 NEW.schema_version=1;NEW.issued_at=date_trunc('milliseconds',clock_timestamp());
 IF NEW.kind='booking_charge' THEN
  SELECT jsonb_build_object('organization_name',org.display_name,'franchise_name',f.display_name,'franchise_code',f.franchise_code,
   'supplier_gstin',t.policy->>'supplier_gstin','supplier_state',b.tax_snapshot->>'supplier_state') INTO issuer
  FROM shipit.franchises f JOIN shipit.organizations org ON org.id=f.organization_id
  JOIN shipit.tax_versions t ON t.organization_id=f.organization_id AND t.franchise_id=f.id AND t.id=(b.tax_snapshot->>'policy_id')::uuid AND t.state='published'
  WHERE f.organization_id=NEW.organization_id AND f.id=NEW.franchise_id;
  IF issuer IS NULL OR issuer->>'supplier_gstin' IS NULL THEN RAISE EXCEPTION 'RECEIPT_TAX_EVIDENCE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT jsonb_agg(jsonb_build_object('docket',p.docket,'weight_grams',p.weight_grams) ORDER BY p.position) INTO parts
  FROM shipit.parcels p WHERE p.organization_id=NEW.organization_id AND p.franchise_id=NEW.franchise_id AND p.booking_id=NEW.booking_id;
  IF jsonb_array_length(parts) IS DISTINCT FROM b.parcel_count THEN RAISE EXCEPTION 'RECEIPT_PARCELS_INVALID' USING ERRCODE='23514'; END IF;
  shipment=jsonb_build_object('customer_name',b.customer_snapshot->>'name','confirmed_at',shipit.lot_wire_time(b.confirmed_at),'service',b.pricing_snapshot->'inputs'->>'service','parcels',parts);
  SELECT jsonb_object_agg(key,value) INTO tax FROM jsonb_each(b.tax_snapshot) WHERE key=ANY(ARRAY[
   'policy_id','policy_version','rule_id','classification','treatment','supplier_state','place_of_supply','jurisdiction',
   'pre_tax_paise','taxable_basis_paise','cgst_paise','sgst_paise','igst_paise','tax_total_paise','unrounded_payable_paise',
   'rounding_adjustment_paise','final_payable_paise','components','allocation']);
  IF ((tax->>'final_payable_paise')::numeric=b.final_payable_paise AND b.final_payable_paise=o.total_paise
   AND (tax->>'cgst_paise')::numeric+(tax->>'sgst_paise')::numeric+(tax->>'igst_paise')::numeric=(tax->>'tax_total_paise')::numeric
   AND (b.pricing_snapshot->>'freight_paise')::numeric+(b.pricing_snapshot->>'packing_paise')::numeric=(tax->>'pre_tax_paise')::numeric
   AND (tax->>'pre_tax_paise')::numeric+(tax->>'tax_total_paise')::numeric=(tax->>'unrounded_payable_paise')::numeric
   AND (tax->>'unrounded_payable_paise')::numeric+(tax->>'rounding_adjustment_paise')::numeric=b.final_payable_paise) IS NOT TRUE
  THEN RAISE EXCEPTION 'RECEIPT_AMOUNTS_INVALID' USING ERRCODE='23514'; END IF;
  NEW.version=1;
  NEW.snapshot=jsonb_build_object('currency','INR','issuer',issuer,'booking',shipment,'charges',jsonb_build_object(
   'freight_paise',b.pricing_snapshot->'freight_paise','packing_paise',b.pricing_snapshot->'packing_paise','tax',tax));
 ELSE
  SELECT id,snapshot INTO base FROM shipit.issued_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.booking_receipt_id AND kind='booking_charge';
  SELECT id,kind,amount_paise,currency,context,method,collection_reference,reversal_of,reason_code,sequence,occurred_at INTO e FROM shipit.payment_entries WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND obligation_id=o.id AND id=NEW.payment_entry_id;
  IF base.id IS NULL OR e.id IS NULL OR NEW.kind IS DISTINCT FROM (CASE e.kind WHEN 'collection' THEN 'collection_acknowledgement' ELSE 'collection_reversal' END)
  THEN RAISE EXCEPTION 'RECEIPT_PAYMENT_INVALID' USING ERRCODE='23514'; END IF;
  IF e.kind='reversal' THEN
   SELECT id,version INTO original FROM shipit.issued_receipts WHERE organization_id=NEW.organization_id AND franchise_id=NEW.franchise_id AND booking_id=NEW.booking_id AND id=NEW.correction_of AND kind='collection_acknowledgement' AND payment_entry_id=e.reversal_of;
   IF original.id IS NULL OR original.version>=e.sequence THEN RAISE EXCEPTION 'RECEIPT_CORRECTION_INVALID' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.version=e.sequence;
  -- Entry-only evidence: deliberately omit payment_result's mutable/as-of balance.
  payment=jsonb_build_object('id',e.id,'kind',e.kind,'amount_paise',e.amount_paise,'currency',e.currency,'context',e.context,'method',e.method,
   'collection_reference',e.collection_reference,'reversal_of',e.reversal_of,'reason_code',e.reason_code,'version',e.sequence,'occurred_at',shipit.lot_wire_time(e.occurred_at));
  NEW.snapshot=jsonb_build_object('currency','INR','issuer',base.snapshot->'issuer','booking',base.snapshot->'booking','entry',payment);
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER issued_receipt_snapshot BEFORE INSERT OR UPDATE OR DELETE ON shipit.issued_receipts FOR EACH ROW EXECUTE FUNCTION shipit.issue_receipt_snapshot();
CREATE FUNCTION shipit.audit_receipt_issuance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 INSERT INTO shipit.receipt_audit_events(id,organization_id,franchise_id,booking_id,actor_id,correlation_id,occurred_at,version)
 VALUES(NEW.id,NEW.organization_id,NEW.franchise_id,NEW.booking_id,NEW.actor_id,NEW.correlation_id,NEW.issued_at,NEW.version);
 RETURN NULL;
END $fn$;
CREATE TRIGGER receipt_issuance_audit AFTER INSERT ON shipit.issued_receipts FOR EACH ROW EXECUTE FUNCTION shipit.audit_receipt_issuance();
DO $extend$
DECLARE source text;expr text;
BEGIN
 SELECT pg_get_viewdef('shipit.audit_history'::regclass,true) INTO source;
 EXECUTE 'CREATE OR REPLACE VIEW shipit.audit_history AS '||rtrim(source,E';\n ')||$view$
 UNION ALL SELECT 'receipt:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'receipts.issued','receipt',id,'success','receipt_issued',correlation_id,occurred_at,NULL,NULL,version,NULL FROM shipit.receipt_audit_events$view$;
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_action_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK ((%s) OR action=''receipts.read'')',expr);
 SELECT pg_get_expr(conbin,conrelid) INTO expr FROM pg_constraint WHERE conrelid='shipit.audit_records'::regclass AND conname='audit_records_resource_type_check';
 ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
 EXECUTE format('ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check CHECK ((%s) OR resource_type=''receipt'')',expr);
END $extend$;
REVOKE ALL ON shipit.issued_receipts,shipit.receipt_audit_events,shipit.issued_receipt_numbers FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.issue_receipt_snapshot(),shipit.audit_receipt_issuance() FROM PUBLIC;
`);
};
