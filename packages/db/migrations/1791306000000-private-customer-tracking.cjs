// Forward-only. Existing phones/consent never become shipment access implicitly.
exports.up = pgm => pgm.sql(String.raw`
CREATE TABLE shipit.customer_access_bindings (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 parcel_id uuid NOT NULL, installation_id uuid NOT NULL,
 relation text NOT NULL CHECK(relation IN ('sender','recipient')),
 contact_key text NOT NULL CHECK(contact_key ~ '^[a-f0-9]{64}$'),
 customer_id uuid, contact_version uuid,
 version integer NOT NULL CHECK(version>0), evidence_ref uuid NOT NULL, inbox_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES shipit.auth_users(id), correlation_id uuid NOT NULL,
 verified_at timestamptz NOT NULL CHECK(isfinite(verified_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at) AND expires_at>verified_at),
 UNIQUE(organization_id,franchise_id,id), UNIQUE(organization_id,franchise_id,parcel_id,relation),
 FOREIGN KEY(organization_id,franchise_id,installation_id) REFERENCES shipit.whatsapp_installations(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,parcel_id) REFERENCES shipit.parcels(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,customer_id) REFERENCES shipit.customers(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id),
 CHECK((relation='sender' AND customer_id IS NOT NULL AND contact_version IS NOT NULL) OR
       (relation='recipient' AND customer_id IS NULL AND contact_version IS NULL))
);
CREATE INDEX customer_access_contact ON shipit.customer_access_bindings(organization_id,franchise_id,installation_id,contact_key,id);
CREATE TABLE shipit.customer_access_commands (
 organization_id uuid NOT NULL, franchise_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES shipit.auth_users(id),
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'), fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 binding_id uuid NOT NULL, result jsonb NOT NULL, correlation_id uuid NOT NULL,
 evidence_ref uuid NOT NULL, inbox_id uuid NOT NULL, relation text NOT NULL CHECK(relation IN ('sender','recipient')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,franchise_id,actor_id,key_digest),
 FOREIGN KEY(organization_id,franchise_id,binding_id) REFERENCES shipit.customer_access_bindings(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id)
);
CREATE TABLE shipit.customer_tracking_grants (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, franchise_id uuid NOT NULL,
 binding_id uuid NOT NULL, binding_version integer NOT NULL CHECK(binding_version>0), inbox_id uuid NOT NULL,
 token_digest text NOT NULL UNIQUE CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(binding_id,binding_version,inbox_id),
 FOREIGN KEY(organization_id,franchise_id,binding_id) REFERENCES shipit.customer_access_bindings(organization_id,franchise_id,id),
 FOREIGN KEY(organization_id,franchise_id,inbox_id) REFERENCES shipit.whatsapp_inbox(organization_id,franchise_id,id)
);
CREATE FUNCTION shipit.customer_tracking_scope(digest text) RETURNS TABLE(organization_id uuid,franchise_id uuid)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT g.organization_id,g.franchise_id FROM shipit.customer_tracking_grants g
 JOIN shipit.customer_access_bindings b ON b.organization_id=g.organization_id AND b.franchise_id=g.franchise_id AND b.id=g.binding_id
 WHERE g.token_digest=digest AND g.expires_at>clock_timestamp() AND b.expires_at>clock_timestamp() AND g.binding_version=b.version
 $fn$;
CREATE TRIGGER customer_access_commands_immutable BEFORE UPDATE OR DELETE ON shipit.customer_access_commands
 FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
CREATE TRIGGER customer_tracking_grants_immutable BEFORE UPDATE OR DELETE ON shipit.customer_tracking_grants
 FOR EACH ROW EXECUTE FUNCTION shipit.whatsapp_inbox_append_only();
REVOKE ALL ON shipit.customer_access_bindings,shipit.customer_access_commands,shipit.customer_tracking_grants FROM PUBLIC;
REVOKE ALL ON FUNCTION shipit.customer_tracking_scope(text) FROM PUBLIC;
`);
