// Existing generic installations retain their file workflows. New manual-only
// installations opt out explicitly; the existing append-only trigger protects it.
exports.up = pgm => pgm.sql(`
ALTER TABLE shipit.carrier_installations ADD COLUMN file_import boolean NOT NULL DEFAULT true;
CREATE INDEX carrier_manual_health_idx ON shipit.carrier_tracking_records
 (organization_id,franchise_id,installation_id,received_at DESC,id DESC) WHERE source_mode='manual';
`);
exports.down = () => { throw new Error('Forward-only migration'); };
