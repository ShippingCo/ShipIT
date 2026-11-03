// Keep a parcel-scoped proof identity when no recipient phone was supplied.
exports.up = pgm => pgm.sql(`
  ALTER TABLE shipit.delivery_recipients ALTER COLUMN phone_normalized DROP NOT NULL;
`);
exports.down = () => { throw new Error('Forward-only: preserve delivery recipients without a phone'); };
