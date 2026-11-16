// Counter staff type a customer's name the way they remember it, not the way it was
// first saved. The prefix search compared `name LIKE $1` against a case-sensitive
// index, so "ravi" never found "Ravi" and the screen told the operator to match the
// original capitalisation instead. Index the folded name so the search can be
// case-insensitive and still use an index for a prefix scan.
exports.up = pgm => pgm.sql(`
  CREATE INDEX customers_name_folded_prefix_idx
    ON shipit.customers(organization_id,franchise_id,lower(name) text_pattern_ops);
`);
exports.down = pgm => pgm.sql(`DROP INDEX shipit.customers_name_folded_prefix_idx;`);
