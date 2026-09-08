// Forward-only infrastructure boundary. Domain tables belong to later issues.
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA shipit; REVOKE ALL ON SCHEMA shipit FROM PUBLIC;');
};
