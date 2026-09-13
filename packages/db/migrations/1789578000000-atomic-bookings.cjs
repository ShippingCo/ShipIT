// Forward-only. Runtime grants are explicit deployment operations, never role discovery.
exports.up = pgm => {
  pgm.sql(String.raw`
    CREATE SEQUENCE shipit.global_docket_sequence AS bigint MINVALUE 1 NO CYCLE;
    REVOKE ALL ON SEQUENCE shipit.global_docket_sequence FROM PUBLIC;
    CREATE TABLE shipit.booking_commands (
      id uuid CONSTRAINT booking_commands_pkey PRIMARY KEY,
      principal_type text NOT NULL CONSTRAINT booking_commands_principal_check CHECK(principal_type='user'),
      principal_id uuid NOT NULL CONSTRAINT booking_commands_principal_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      operation_id text NOT NULL CONSTRAINT booking_commands_operation_check CHECK(operation_id='api.v1.bookings.create'),
      key_digest text NOT NULL CONSTRAINT booking_commands_digest_check CHECK(key_digest ~ '^[0-9a-f]{64}$'),
      fingerprint text NOT NULL CONSTRAINT booking_commands_fingerprint_check CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
      normalization_version integer NOT NULL CONSTRAINT booking_commands_normalization_check CHECK(normalization_version=1),
      booking_id uuid NOT NULL, correlation_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'reserved', http_status integer, result jsonb, committed_at timestamptz, retain_until timestamptz,
      CONSTRAINT booking_commands_identity_key UNIQUE(principal_type,principal_id,organization_id,franchise_id,operation_id,key_digest),
      CONSTRAINT booking_commands_owner_key UNIQUE(organization_id,franchise_id,id,booking_id),
      CONSTRAINT booking_commands_franchise_fk FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT booking_commands_result_check CHECK(
        (state='reserved' AND http_status IS NULL AND result IS NULL AND committed_at IS NULL AND retain_until IS NULL) OR
        (state='committed' AND (http_status=201 AND jsonb_typeof(result)='object' AND octet_length(result::text)<=524288
          AND result->>'id'=booking_id::text AND isfinite(committed_at) AND isfinite(retain_until)
          AND retain_until>=committed_at+interval '24 hours') IS TRUE))
    );
    CREATE TABLE shipit.bookings (
      id uuid CONSTRAINT bookings_pkey PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, command_id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1 CONSTRAINT bookings_version_check CHECK(version=1),
      state text NOT NULL DEFAULT 'active' CONSTRAINT bookings_state_check CHECK(state='active'),
      customer_id uuid NOT NULL, customer_version integer NOT NULL CONSTRAINT bookings_customer_version_check CHECK(customer_version>0),
      customer_snapshot jsonb NOT NULL, pricing_quote_id uuid NOT NULL, tax_calculation_id uuid NOT NULL,
      pricing_snapshot jsonb NOT NULL, tax_snapshot jsonb NOT NULL, tax_intent jsonb NOT NULL,
      confirmed_at timestamptz NOT NULL CONSTRAINT bookings_time_check CHECK(isfinite(confirmed_at)),
      parcel_count integer NOT NULL CONSTRAINT bookings_parcel_count_check CHECK(parcel_count BETWEEN 1 AND 50),
      parcel_set_ref uuid NOT NULL CONSTRAINT bookings_parcel_set_key UNIQUE,
      final_payable_paise bigint NOT NULL CONSTRAINT bookings_payable_check CHECK(final_payable_paise BETWEEN 0 AND 9007199254740991),
      CONSTRAINT bookings_owner_key UNIQUE(organization_id,franchise_id,id),
      CONSTRAINT bookings_payable_key UNIQUE(organization_id,franchise_id,id,final_payable_paise),
      CONSTRAINT bookings_command_key UNIQUE(command_id),
      CONSTRAINT bookings_franchise_fk FOREIGN KEY(organization_id,franchise_id) REFERENCES shipit.franchises(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT bookings_customer_fk FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CONSTRAINT bookings_quote_fk FOREIGN KEY(organization_id,franchise_id,pricing_quote_id) REFERENCES shipit.pricing_quotes(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CONSTRAINT bookings_tax_fk FOREIGN KEY(organization_id,franchise_id,tax_calculation_id) REFERENCES shipit.tax_calculations(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CONSTRAINT bookings_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,id) REFERENCES shipit.booking_commands(organization_id,franchise_id,id,booking_id) ON DELETE RESTRICT,
      CONSTRAINT bookings_snapshot_check CHECK((jsonb_typeof(customer_snapshot)='object' AND octet_length(customer_snapshot::text)<=4096
        AND customer_snapshot->>'source_customer_id'=customer_id::text AND (customer_snapshot->>'source_customer_version')::integer=customer_version
        AND jsonb_typeof(pricing_snapshot)='object' AND octet_length(pricing_snapshot::text)<=8192
        AND jsonb_typeof(tax_snapshot)='object' AND octet_length(tax_snapshot::text)<=8192
        AND jsonb_typeof(tax_intent)='object' AND octet_length(tax_intent::text)<=4096
        AND (tax_snapshot->>'final_payable_paise')::numeric=final_payable_paise) IS TRUE)
    );
    ALTER TABLE shipit.booking_commands ADD CONSTRAINT booking_commands_booking_fk FOREIGN KEY(organization_id,franchise_id,booking_id)
      REFERENCES shipit.bookings(organization_id,franchise_id,id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE shipit.parcels (
      id uuid CONSTRAINT parcels_pkey PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL,
      position integer NOT NULL CONSTRAINT parcels_position_check CHECK(position BETWEEN 1 AND 50),
      docket text NOT NULL CONSTRAINT parcels_docket_check CHECK(length(docket) BETWEEN 1 AND 32 AND docket ~ '^[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?$'),
      version integer NOT NULL DEFAULT 1 CONSTRAINT parcels_version_check CHECK(version=1),
      status text NOT NULL DEFAULT 'booked' CONSTRAINT parcels_status_check CHECK(status='booked'),
      custody text NOT NULL DEFAULT 'awaiting_intake' CONSTRAINT parcels_custody_check CHECK(custody='awaiting_intake'),
      weight_grams bigint NOT NULL CONSTRAINT parcels_weight_check CHECK(weight_grams BETWEEN 1 AND 9007199254740991),
      sender_snapshot jsonb NOT NULL, recipient_snapshot jsonb NOT NULL,
      CONSTRAINT parcels_snapshot_check CHECK(jsonb_typeof(sender_snapshot)='object' AND jsonb_typeof(recipient_snapshot)='object'
        AND octet_length(sender_snapshot::text)<=4096 AND octet_length(recipient_snapshot::text)<=4096),
      CONSTRAINT parcels_docket_key UNIQUE(docket),
      CONSTRAINT parcels_position_key UNIQUE(organization_id,franchise_id,booking_id,position),
      CONSTRAINT parcels_owner_key UNIQUE(organization_id,franchise_id,booking_id,id),
      CONSTRAINT parcels_booking_fk FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.allocate_docket() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE allocated bigint; watermark bigint; used boolean;
    BEGIN
      IF NEW.docket IS NULL THEN
        allocated=nextval('shipit.global_docket_sequence');
        NEW.docket='SIT-'||lpad(allocated::text,19,'0');
      ELSIF NEW.docket ~ '^SIT-[0-9]{19}$' THEN
        SELECT last_value,is_called INTO watermark,used FROM shipit.global_docket_sequence;
        IF used AND substring(NEW.docket FROM 5)::numeric<=watermark THEN
          RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='parcels_docket_reserved',MESSAGE='DOCKET_CONFLICT';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER parcels_allocate BEFORE INSERT ON shipit.parcels FOR EACH ROW EXECUTE FUNCTION shipit.allocate_docket();
    CREATE TABLE shipit.booking_obligations (
      id uuid CONSTRAINT booking_obligations_pkey PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL, booking_id uuid NOT NULL,
      currency text NOT NULL DEFAULT 'INR' CONSTRAINT booking_obligations_currency_check CHECK(currency='INR'),
      state text NOT NULL DEFAULT 'uncollected' CONSTRAINT booking_obligations_state_check CHECK(state='uncollected'),
      total_paise bigint NOT NULL, collected_paise bigint NOT NULL, outstanding_paise bigint NOT NULL,
      CONSTRAINT booking_obligations_amount_check CHECK(total_paise BETWEEN 0 AND 9007199254740991 AND collected_paise=0 AND outstanding_paise>=0
        AND collected_paise+outstanding_paise=total_paise),
      CONSTRAINT booking_obligations_booking_key UNIQUE(organization_id,franchise_id,booking_id),
      CONSTRAINT booking_obligations_payable_fk FOREIGN KEY(organization_id,franchise_id,booking_id,total_paise)
        REFERENCES shipit.bookings(organization_id,franchise_id,id,final_payable_paise) ON DELETE RESTRICT
    );
    CREATE TABLE shipit.domain_events (
      event_id uuid CONSTRAINT domain_events_pkey PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      booking_id uuid NOT NULL, parcel_id uuid, command_id uuid NOT NULL, event_type text NOT NULL, aggregate_id uuid NOT NULL, envelope jsonb NOT NULL,
      CONSTRAINT domain_events_logical_key UNIQUE(event_type,aggregate_id),
      CONSTRAINT domain_events_booking_fk FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CONSTRAINT domain_events_parcel_fk FOREIGN KEY(organization_id,franchise_id,booking_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,booking_id,id) ON DELETE RESTRICT,
      CONSTRAINT domain_events_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,booking_id) REFERENCES shipit.booking_commands(organization_id,franchise_id,id,booking_id) ON DELETE RESTRICT,
      CONSTRAINT domain_events_type_check CHECK((event_type='booking.created' AND parcel_id IS NULL AND aggregate_id=booking_id)
        OR (event_type='parcel.booked' AND parcel_id IS NOT NULL AND aggregate_id=parcel_id)),
      CONSTRAINT domain_events_envelope_check CHECK((jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=2048
        AND envelope->>'event_id'=event_id::text AND envelope->>'organization_id'=organization_id::text AND envelope->>'franchise_id'=franchise_id::text
        AND envelope->>'event_type'=event_type AND envelope->>'aggregate_id'=aggregate_id::text AND envelope->>'schema_version'='1'
        AND envelope->>'aggregate_version'='1' AND envelope->>'command_id'=command_id::text AND envelope->>'causation_id'=command_id::text
        AND envelope - ARRAY['event_id','event_type','schema_version','organization_id','franchise_id','aggregate_type','aggregate_id','aggregate_version','occurred_at','actor','correlation_id','causation_id','command_id','payload']='{}'::jsonb) IS TRUE)
    );
    CREATE INDEX domain_events_owner_idx ON shipit.domain_events(organization_id,franchise_id,booking_id);
    CREATE TABLE shipit.booking_audit_events (
      id uuid CONSTRAINT booking_audit_pkey PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
      booking_id uuid NOT NULL, command_id uuid NOT NULL, actor_id uuid NOT NULL CONSTRAINT booking_audit_actor_fk REFERENCES shipit.auth_users(id) ON DELETE RESTRICT,
      correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL CONSTRAINT booking_audit_time_check CHECK(isfinite(occurred_at)),
      CONSTRAINT booking_audit_booking_key UNIQUE(organization_id,franchise_id,booking_id),
      CONSTRAINT booking_audit_booking_fk FOREIGN KEY(organization_id,franchise_id,booking_id) REFERENCES shipit.bookings(organization_id,franchise_id,id) ON DELETE RESTRICT,
      CONSTRAINT booking_audit_command_fk FOREIGN KEY(organization_id,franchise_id,command_id,booking_id) REFERENCES shipit.booking_commands(organization_id,franchise_id,id,booking_id) ON DELETE RESTRICT
    );
    CREATE FUNCTION shipit.append_booking_audit(org uuid,franchise uuid,booking uuid,command uuid,actor uuid,correlation uuid,at_time timestamptz)
    RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
      INSERT INTO shipit.booking_audit_events(id,organization_id,franchise_id,booking_id,command_id,actor_id,correlation_id,occurred_at)
        VALUES(command,org,franchise,booking,command,actor,correlation,at_time)
    $fn$;
    CREATE FUNCTION shipit.guard_booking_child() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM shipit.bookings b JOIN shipit.booking_commands c ON c.id=b.command_id
        WHERE b.organization_id=NEW.organization_id AND b.franchise_id=NEW.franchise_id AND b.id=NEW.booking_id AND c.state='reserved')
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_already_committed',MESSAGE='BOOKING_IMMUTABLE'; END IF;
      RETURN NEW;
    END $fn$;
    REVOKE ALL ON FUNCTION shipit.guard_booking_child() FROM PUBLIC;
    CREATE FUNCTION shipit.reject_booking_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_immutable',MESSAGE='BOOKING_IMMUTABLE'; END $fn$;
    CREATE FUNCTION shipit.guard_booking_command() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
    BEGIN
      IF TG_OP='DELETE' OR OLD.state<>'reserved' OR NEW.state<>'committed' OR
        (to_jsonb(NEW)-ARRAY['state','http_status','result','committed_at','retain_until'])<>(to_jsonb(OLD)-ARRAY['state','http_status','result','committed_at','retain_until'])
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_command_immutable',MESSAGE='BOOKING_IMMUTABLE'; END IF;
      RETURN NEW;
    END $fn$;
    CREATE TRIGGER booking_commands_guard BEFORE UPDATE OR DELETE ON shipit.booking_commands FOR EACH ROW EXECUTE FUNCTION shipit.guard_booking_command();
    CREATE FUNCTION shipit.check_booking_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
    DECLARE b shipit.bookings; c shipit.booking_commands; customer shipit.customers; quote jsonb; tax jsonb; p shipit.parcels; e shipit.domain_events;
    BEGIN
      SELECT * INTO c FROM shipit.booking_commands WHERE id=NEW.id;
      SELECT * INTO b FROM shipit.bookings WHERE id=c.booking_id AND organization_id=c.organization_id AND franchise_id=c.franchise_id;
      IF c.state<>'committed' OR b.id IS NULL OR
        (SELECT count(*) FROM shipit.parcels WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id)<>b.parcel_count OR
        (SELECT count(*) FROM shipit.booking_obligations WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id)<>1 OR
        (SELECT count(*) FROM shipit.booking_audit_events WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id AND actor_id=c.principal_id AND correlation_id=c.correlation_id AND occurred_at=b.confirmed_at)<>1 OR
        (SELECT count(*) FROM shipit.domain_events WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id)<>b.parcel_count+1
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_complete',MESSAGE='BOOKING_INCOMPLETE'; END IF;
      SELECT * INTO customer FROM shipit.customers WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND id=b.customer_id FOR SHARE;
      SELECT result INTO quote FROM shipit.pricing_quotes WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND id=b.pricing_quote_id AND actor_id=c.principal_id;
      SELECT result INTO tax FROM shipit.tax_calculations WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND id=b.tax_calculation_id AND actor_id=c.principal_id;
      IF NOT COALESCE(b.customer_snapshot=jsonb_build_object('source_customer_id',customer.id,'source_customer_version',customer.version,'name',customer.name,'phone',customer.phone_normalized,'phone_display',customer.phone_display,'address',customer.address)
        AND b.pricing_snapshot=quote AND b.tax_snapshot=tax AND b.tax_snapshot->>'quote_id'=b.pricing_quote_id::text
        AND b.tax_intent=(SELECT input FROM shipit.tax_intents WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND id=(tax->>'intent_id')::uuid)
        AND (SELECT sum(weight_grams) FROM shipit.parcels WHERE booking_id=b.id)=(quote->'inputs'->>'weight_grams')::numeric,false)
      THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_snapshot_source',MESSAGE='BOOKING_SNAPSHOT_INVALID'; END IF;
      FOR p IN SELECT * FROM shipit.parcels WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id LOOP
        IF p.sender_snapshot<>b.customer_snapshot OR p.position>b.parcel_count THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_parcel_snapshot',MESSAGE='BOOKING_SNAPSHOT_INVALID'; END IF;
      END LOOP;
      FOR e IN SELECT * FROM shipit.domain_events WHERE organization_id=b.organization_id AND franchise_id=b.franchise_id AND booking_id=b.id LOOP
        IF NOT COALESCE(e.envelope->'actor'=jsonb_build_object('type','user','id',c.principal_id)
          AND e.envelope->>'correlation_id'=c.correlation_id::text AND (e.envelope->>'occurred_at')::timestamptz=b.confirmed_at
          AND e.envelope->>'aggregate_type'=CASE WHEN e.parcel_id IS NULL THEN 'booking' ELSE 'parcel' END
          AND e.envelope->'payload'=CASE WHEN e.parcel_id IS NULL THEN jsonb_build_object('parcel_set_ref',b.parcel_set_ref) ELSE jsonb_build_object('booking_id',b.id) END,false)
        THEN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='booking_event_evidence',MESSAGE='BOOKING_EVENT_INVALID'; END IF;
      END LOOP;
      RETURN NULL;
    END $fn$;
    CREATE CONSTRAINT TRIGGER booking_complete AFTER INSERT OR UPDATE ON shipit.booking_commands DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION shipit.check_booking_complete();
    REVOKE ALL ON shipit.bookings,shipit.parcels,shipit.booking_commands,shipit.booking_obligations,shipit.domain_events,shipit.booking_audit_events FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.allocate_docket(),shipit.reject_booking_mutation(),shipit.guard_booking_command(),shipit.check_booking_complete(),
      shipit.append_booking_audit(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
  `);
  for (const table of ['bookings','parcels','booking_obligations','domain_events','booking_audit_events']) {
    pgm.sql(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON shipit.${table} FOR EACH ROW EXECUTE FUNCTION shipit.reject_booking_mutation()`);
  }
  for (const table of ['parcels','booking_obligations','domain_events','booking_audit_events']) {
    pgm.sql(`CREATE TRIGGER ${table}_creation_guard BEFORE INSERT ON shipit.${table} FOR EACH ROW EXECUTE FUNCTION shipit.guard_booking_child()`);
  }
  // Preserve the current full audit projection and its grants, adding one safe fact kind.
  pgm.sql(`CREATE OR REPLACE VIEW shipit.audit_history AS
    SELECT 'audit:'||id::text AS id,organization_id,CASE WHEN franchise_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[franchise_id] END AS franchise_ids,
      actor_type,actor_id,action,resource_type,resource_id,result,reason_code,correlation_id,occurred_at,previous_lifecycle,new_lifecycle,committed_version,NULL::text AS role FROM shipit.audit_records
    UNION ALL SELECT 'membership:'||id::text,organization_id,franchise_ids,actor_type,COALESCE(actor_user_id::text,'onboarding'),action,
      CASE WHEN invitation_id IS NULL THEN 'membership' ELSE 'invitation' END,COALESCE(invitation_id,membership_id),'success','grant_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,role FROM shipit.membership_audit_events
    UNION ALL SELECT 'identity:'||id::text,NULL::uuid,'{}'::uuid[],CASE WHEN action IN ('provision','disable','enable') THEN 'service' ELSE 'user' END,
      CASE WHEN action IN ('provision','disable','enable') THEN 'authentication' ELSE COALESCE(user_id::text,'unknown') END,action,'identity',user_id,'success','identity_change',COALESCE(correlation_id,id),occurred_at,NULL,NULL,NULL,NULL FROM shipit.auth_security_events
    UNION ALL SELECT 'customer:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'customer',customer_id,'success','contact_change',correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.customer_audit_events
    UNION ALL SELECT 'pricing:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'pricing',COALESCE(quote_id,version_id),'success',reason_code,correlation_id,occurred_at,NULL,NULL,committed_version,NULL FROM shipit.pricing_audit_events
    UNION ALL SELECT 'tax:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,action,'tax',resource_id,'success','tax_command',correlation_id,occurred_at,NULL,NULL,NULL,NULL FROM shipit.tax_audit_events
    UNION ALL SELECT 'booking:'||id::text,organization_id,ARRAY[franchise_id],'user',actor_id::text,'bookings.create','booking',booking_id,
      'success','booking_create',correlation_id,occurred_at,NULL,NULL,1,NULL FROM shipit.booking_audit_events`);
  // Preserve current action/resource sets from the predecessor, adding booking denial categories.
  pgm.sql(`ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_action_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_action_check CHECK(action IN (
      'organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage',
      'franchise.profile.update','franchise.lifecycle.manage','audit.read','membership.manage',
      'invitation.create','invitation.accept','invitation.revoke','auth.start','auth.verify','auth.resend',
      'auth.session','auth.manage','security.request','customer.read','customer.list','customer.create','customer.update',
      'pricing.read','pricing.draft','pricing.publish','pricing.quote','tax.read','tax.draft','tax.publish','tax.prepare','tax.resolve','tax.calculate','bookings.create'));
    ALTER TABLE shipit.audit_records DROP CONSTRAINT audit_records_resource_type_check;
    ALTER TABLE shipit.audit_records ADD CONSTRAINT audit_records_resource_type_check
      CHECK(resource_type IN ('organization','franchise','membership','invitation','identity','audit','request','customer','pricing','tax','booking','parcel'));`);
};
