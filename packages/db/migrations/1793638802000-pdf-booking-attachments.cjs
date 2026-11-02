// Add PDF evidence to the existing private, scanned attachment pipeline.
exports.up = pgm => {
 pgm.sql(String.raw`
ALTER TABLE shipit.attachments DROP CONSTRAINT attachments_kind_check;
ALTER TABLE shipit.attachments DROP CONSTRAINT attachments_declared_type_check;
-- Locate the original unnamed kind/media pair constraint by its columns, not
-- an assumed generated suffix (later migrations add other table constraints).
DO $migration$
DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT c.conname FROM pg_constraint c
 WHERE c.conrelid='shipit.attachments'::regclass AND c.contype='c'
 AND pg_get_constraintdef(c.oid) LIKE '%kind%'
 AND pg_get_constraintdef(c.oid) LIKE '%declared_type%'
 LOOP EXECUTE format('ALTER TABLE shipit.attachments DROP CONSTRAINT %I',constraint_name); END LOOP;
END $migration$;
ALTER TABLE shipit.attachments ADD CONSTRAINT attachments_kind_check CHECK(kind IN ('image','audio','video','document'));
ALTER TABLE shipit.attachments ADD CONSTRAINT attachments_declared_type_check CHECK(declared_type IN ('image/jpeg','image/png','audio/mpeg','audio/wav','video/mp4','application/pdf'));
ALTER TABLE shipit.attachments ADD CONSTRAINT attachments_kind_media_check CHECK(
 (kind='image' AND declared_type IN ('image/jpeg','image/png')) OR
 (kind='audio' AND declared_type IN ('audio/mpeg','audio/wav')) OR
 (kind='video' AND declared_type='video/mp4') OR
 (kind='document' AND declared_type='application/pdf')
);
 `);
};
exports.down = () => { throw new Error('Forward-only migration'); };
