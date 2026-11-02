exports.up=pgm=>pgm.sql(`
ALTER TABLE shipit.parcels ADD COLUMN booking_details jsonb;
ALTER TABLE shipit.parcels ADD CONSTRAINT parcels_booking_details_check CHECK (
 booking_details IS NULL OR (jsonb_typeof(booking_details)='object' AND octet_length(booking_details::text)<=4096)
);
`);
exports.down=()=>{throw new Error('Forward-only: preserve saved booking details');};
