// Trip events (left, delayed, arrived) carry an optional note for the team. The API has
// accepted and stored `note` since the dispatch workspace asked for one, and the trip
// history reads it back from the stored input, but the input check written with atomic
// route events still allowed only the original keys. Every departure, delay and arrival
// sent from the console therefore failed the check and surfaced as a generic 503, which
// operators saw as "we could not tell whether this saved".
//
// The check is unchanged except that each event may now carry `note`: a string of at most
// 1000 characters, the same limit the API validates.
const keys = {
  departure: "'kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref','base_eta_at'",
  delay: "'kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref','total_delay_minutes'",
  arrival: "'kind','expected_version','manifest_id','manifest_version','effective_at','evidence_ref'",
};
const check = withNote => {
  const list = names => (withNote ? `${names},'note'` : names);
  return `ALTER TABLE shipit.route_commands ADD CONSTRAINT route_event_input_check CHECK(operation_id NOT IN
 ('api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival') OR (
 input->>'kind'=substring(operation_id from 15) AND input->>'expected_version'=expected_version::text
 AND (input->>'manifest_id')::uuid IS NOT NULL AND (input->>'manifest_version')::integer BETWEEN 1 AND 2147483646
 AND isfinite((input->>'effective_at')::timestamptz) AND (input->>'evidence_ref')::uuid IS NOT NULL
 ${withNote ? "AND (NOT input ? 'note' OR (jsonb_typeof(input->'note')='string' AND char_length(input->>'note')<=1000))" : ''}
 AND CASE operation_id WHEN 'api.v1.routes.departure' THEN
   input-ARRAY[${list(keys.departure)}]='{}'::jsonb
   AND input ? 'base_eta_at' AND (input->'base_eta_at'='null'::jsonb OR (isfinite((input->>'base_eta_at')::timestamptz) AND (input->>'base_eta_at')::timestamptz >= (input->>'effective_at')::timestamptz))
 WHEN 'api.v1.routes.delay' THEN input-ARRAY[${list(keys.delay)}]='{}'::jsonb
   AND (input->>'total_delay_minutes')::integer BETWEEN 0 AND 43200
 ELSE input-ARRAY[${list(keys.arrival)}]='{}'::jsonb END) IS TRUE);`;
};
exports.up = pgm => pgm.sql(`ALTER TABLE shipit.route_commands DROP CONSTRAINT route_event_input_check;\n${check(true)}`);
// Down restores the original check; it fails if any stored event already carries a note,
// which is the honest outcome: those notes would otherwise be silently invalid.
exports.down = pgm => pgm.sql(`ALTER TABLE shipit.route_commands DROP CONSTRAINT route_event_input_check;\n${check(false)}`);
