// Forward-only tenancy roots. Runtime grants are provisioned separately for the
// deployment's actual runtime identity; migrations never embed role names.
exports.up = (pgm) => {
  pgm.sql(String.raw`
    CREATE TABLE shipit.organizations (
      id uuid PRIMARY KEY,
      display_name text NOT NULL,
      lifecycle text NOT NULL DEFAULT 'active',
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      CONSTRAINT organizations_display_name_valid CHECK (
        char_length(display_name) BETWEEN 1 AND 120 AND
        (display_name COLLATE "C") !~ '[[:cntrl:]]' AND
        display_name = btrim(display_name,
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      ),
      CONSTRAINT organizations_lifecycle_valid CHECK (lifecycle IN ('active', 'disabled')),
      CONSTRAINT organizations_version_positive CHECK (version > 0)
    );

    CREATE TABLE shipit.franchises (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      franchise_code text NOT NULL,
      display_name text NOT NULL,
      lifecycle text NOT NULL DEFAULT 'active',
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      lifecycle_changed_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
      CONSTRAINT franchises_organization_fk FOREIGN KEY (organization_id)
        REFERENCES shipit.organizations (id) ON DELETE RESTRICT,
      CONSTRAINT franchises_organization_id_key UNIQUE (organization_id, id),
      CONSTRAINT franchises_organization_code_key UNIQUE (organization_id, franchise_code),
      CONSTRAINT franchises_code_valid CHECK (
        (franchise_code COLLATE "C") ~ '^[A-Z][A-Z0-9_]{0,31}$'
      ),
      CONSTRAINT franchises_display_name_valid CHECK (
        char_length(display_name) BETWEEN 1 AND 120 AND
        (display_name COLLATE "C") !~ '[[:cntrl:]]' AND
        display_name = btrim(display_name,
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      ),
      CONSTRAINT franchises_lifecycle_valid CHECK (lifecycle IN ('active', 'disabled')),
      CONSTRAINT franchises_version_positive CHECK (version > 0)
    );

    CREATE INDEX franchises_organization_created_id_idx
      ON shipit.franchises (organization_id, created_at, id);

    CREATE FUNCTION shipit.reject_organization_identity_update() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TENANCY_IDENTITY_IMMUTABLE';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION shipit.reject_franchise_identity_update() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id OR
         NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
         NEW.franchise_code IS DISTINCT FROM OLD.franchise_code OR
         NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TENANCY_IDENTITY_IMMUTABLE';
      END IF;
      RETURN NEW;
    END;
    $function$;

    REVOKE ALL ON FUNCTION shipit.reject_organization_identity_update() FROM PUBLIC;
    REVOKE ALL ON FUNCTION shipit.reject_franchise_identity_update() FROM PUBLIC;

    CREATE TRIGGER organizations_immutable_identity
      BEFORE UPDATE ON shipit.organizations FOR EACH ROW
      EXECUTE FUNCTION shipit.reject_organization_identity_update();
    CREATE TRIGGER franchises_immutable_identity
      BEFORE UPDATE ON shipit.franchises FOR EACH ROW
      EXECUTE FUNCTION shipit.reject_franchise_identity_update();
  `);
};
